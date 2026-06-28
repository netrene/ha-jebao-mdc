"""Local protocol client for JEBAO MDC pumps."""

from __future__ import annotations

import socket
import time
from dataclasses import dataclass

from .const import DEFAULT_DISCOVERY_PORT, DEFAULT_PASSCODE, DEFAULT_PORT


class JebaoMdcError(RuntimeError):
    """Base error for JEBAO MDC protocol failures."""


@dataclass(frozen=True)
class PumpStatus:
    """Decoded pump status."""

    mode: int | None
    speed: int | None
    raw: bytes

    @property
    def mode_label(self) -> str:
        """Return a human-readable mode label."""
        if self.mode == 0x11:
            return "normal"
        if self.mode == 0x15:
            return "feeding-like"
        if self.mode is None:
            return "unknown"
        return f"0x{self.mode:02x}"


@dataclass(frozen=True)
class DeviceInfo:
    """Decoded discovery information."""

    host: str
    device_id: str
    mac: str
    api_server: str | None
    version: str | None
    raw: bytes


def discover_devices(timeout: float = 4.0) -> list[DeviceInfo]:
    """Discover JEBAO/Gizwits devices via UDP broadcast."""
    devices: dict[str, DeviceInfo] = {}
    request = b"\x00\x00\x00\x03\x03\x00\x00\x03"
    deadline = time.time() + timeout

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(0.5)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind(("", 0))
        sock.sendto(request, ("255.255.255.255", DEFAULT_DISCOVERY_PORT))

        while time.time() < deadline:
            try:
                data, address = sock.recvfrom(512)
            except socket.timeout:
                continue

            info = _parse_device_info(data, address[0])
            if info is not None:
                devices[info.device_id] = info

    return list(devices.values())


class JebaoMdcClient:
    """Synchronous TCP client for the JEBAO MDC LAN protocol."""

    def __init__(
        self,
        host: str,
        port: int = DEFAULT_PORT,
        passcode: str = DEFAULT_PASSCODE,
        timeout: float = 4.0,
    ) -> None:
        """Initialize the client."""
        self.host = host
        self.port = port
        self.passcode = passcode
        self.timeout = timeout
        self._request_id = 3

    def read_status(self) -> PumpStatus:
        """Read pump status."""
        with self._connect_logged_in() as sock:
            sock.sendall(self._status_request(self._next_request_id()))
            return self._parse_status(self._recv_frame(sock))

    def set_speed(self, speed: int) -> PumpStatus | None:
        """Set pump speed percentage."""
        if not 0 <= speed <= 100:
            raise ValueError("speed must be between 0 and 100")

        with self._connect_logged_in() as sock:
            request_id = self._next_request_id()
            sock.sendall(self._speed_command(request_id, speed))
            self._expect_ack(self._recv_frame(sock), request_id)

            deadline = time.time() + 2.5
            while time.time() < deadline:
                try:
                    status = self._parse_status(self._recv_frame(sock))
                except TimeoutError:
                    return None
                if status.speed is not None:
                    return status
            return None

    def discover_device_info(self) -> DeviceInfo | None:
        """Discover device information for this client host."""
        for info in discover_devices(timeout=2.5):
            if info.host == self.host:
                return info
        return None

    def _connect_logged_in(self) -> socket.socket:
        sock = socket.create_connection((self.host, self.port), self.timeout)
        sock.settimeout(self.timeout)
        try:
            self._login(sock)
        except Exception:
            sock.close()
            raise
        return sock

    def _login(self, sock: socket.socket) -> None:
        passcode = self._get_passcode(sock).encode("ascii")
        if len(passcode) != 10:
            raise ValueError("passcode must be exactly 10 ASCII characters")

        sock.sendall(b"\x00\x00\x00\x03\x0f\x00\x00\x08\x00\x0a" + passcode)
        response = self._recv_exact(sock, 9)
        expected = b"\x00\x00\x00\x03\x04\x00\x00\x09\x00"
        if response != expected:
            raise JebaoMdcError(f"login failed: {response.hex(' ')}")

    def _get_passcode(self, sock: socket.socket) -> str:
        """Return the configured passcode or request it from the pump."""
        if self.passcode:
            return self.passcode

        sock.sendall(b"\x00\x00\x00\x03\x03\x00\x00\x06")
        response = self._recv_exact(sock, 20)
        prefix = b"\x00\x00\x00\x03\x0f\x00\x00\x07\x00\x0a"
        if not response.startswith(prefix):
            raise JebaoMdcError(f"passcode request failed: {response.hex(' ')}")

        passcode = response[len(prefix) :].decode("ascii")
        self.passcode = passcode
        return passcode

    def _next_request_id(self) -> int:
        self._request_id += 1
        if self._request_id > 0xFE:
            self._request_id = 4
        return self._request_id

    @staticmethod
    def _status_request(request_id: int) -> bytes:
        return (
            b"\x00\x00\x00\x03\x08\x00\x00\x93"
            + bytes([0x00, 0x00, 0x00, request_id, 0x02])
        )

    @staticmethod
    def _speed_command(request_id: int, speed: int) -> bytes:
        frame = bytearray(323)
        frame[0:13] = b"\x00\x00\x00\x03\xbd\x02\x00\x00\x93\x00\x00\x00" + bytes(
            [request_id]
        )
        frame[13] = 0x01
        frame[21] = 0x20
        frame[23] = speed
        return bytes(frame)

    @staticmethod
    def _expect_ack(frame: bytes, request_id: int) -> None:
        expected = (
            b"\x00\x00\x00\x03\x07\x00\x00\x94\x00\x00\x00"
            + bytes([request_id])
        )
        if frame != expected:
            raise JebaoMdcError(
                f"unexpected ACK for request {request_id}: {frame.hex(' ')}"
            )

    def _recv_frame(self, sock: socket.socket) -> bytes:
        header = self._recv_exact(sock, 8)
        if not header.startswith(b"\x00\x00\x00\x03"):
            raise JebaoMdcError(f"bad frame prefix: {header.hex(' ')}")

        length_field = int.from_bytes(header[4:6], "little")
        if length_field >= 0x0200:
            total_len = length_field - 0x017A
        else:
            total_len = length_field + 5

        if total_len < 8:
            raise JebaoMdcError(f"bad frame length: {header.hex(' ')}")
        return header + self._recv_exact(sock, total_len - 8)

    @staticmethod
    def _recv_exact(sock: socket.socket, length: int) -> bytes:
        data = bytearray()
        while len(data) < length:
            try:
                chunk = sock.recv(length - len(data))
            except socket.timeout as exc:
                raise TimeoutError("timed out while reading from pump") from exc
            if not chunk:
                raise JebaoMdcError("connection closed by pump")
            data.extend(chunk)
        return bytes(data)

    @staticmethod
    def _parse_status(frame: bytes) -> PumpStatus:
        if len(frame) < 16:
            return PumpStatus(None, None, frame)

        if frame[7] == 0x94:
            payload_offset = 8
        elif frame[8] == 0x94:
            payload_offset = 8
        else:
            return PumpStatus(None, None, frame)

        payload = frame[payload_offset:]
        marker = payload.find(b"\x03", 4)
        if marker >= 0 and marker + 2 < len(payload):
            mode = payload[marker + 1]
            speed = payload[marker + 2]
            if mode in (0x11, 0x15) and 0 <= speed <= 100:
                return PumpStatus(mode, speed, frame)

        return PumpStatus(None, None, frame)


def _parse_device_info(frame: bytes, host: str) -> DeviceInfo | None:
    """Parse a Gizwits/GAgent UDP discovery response."""
    if not frame.startswith(b"\x00\x00\x00\x03") or len(frame) < 54:
        return None
    if frame[7] != 0x04:
        return None
    if frame[8:10] != b"\x00\x16":
        return None

    device_id = frame[10:32].rstrip(b"\x00").decode("ascii", errors="ignore")
    if not device_id:
        return None

    if frame[32:34] != b"\x00\x06":
        return None

    mac = frame[34:40].hex(":")
    api_server = None
    version = None

    marker = b"\x00\x00\x00\x00\x00\x00\x00\x02"
    marker_index = frame.find(marker, 40)
    if marker_index >= 0:
        text_start = marker_index + len(marker)
        text = frame[text_start:].split(b"\x00")
        if text and text[0]:
            api_server = text[0].decode("ascii", errors="ignore")
        if len(text) > 1 and text[1]:
            version = text[1].decode("ascii", errors="ignore")

    return DeviceInfo(host, device_id, mac, api_server, version, frame)
