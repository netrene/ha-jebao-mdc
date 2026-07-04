# JEBAO MDC

[![release](https://img.shields.io/github/v/release/netrene/ha-jebao-mdc?style=for-the-badge)](https://github.com/netrene/ha-jebao-mdc/releases)
[![hacs](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://www.hacs.xyz/)
[![license](https://img.shields.io/github/license/netrene/ha-jebao-mdc?style=for-the-badge)](LICENSE)

Experimental Home Assistant custom integration for JEBAO MDC pumps.

Local LAN control for JEBAO MDC pumps with automatic discovery, direct speed
control, and built-in feeding controls.

> [!WARNING]
> This integration has currently been tested with one JEBAO MDC-5000 only.

## Status

Tested against one MDC-5000 on the local LAN:

- Status read over TCP port `12416`
- Speed set as a Home Assistant `fan` percentage
- Device ID and MAC discovery over UDP port `12414`
- Built-in feeding helper entities

The vendor feeding command is not used. Captures show a feeding-like mode byte,
but the observed device did not visibly enter a feeding pause when the vendor app
sent that command. The integration instead implements feeding by temporarily
setting the pump to a configurable feeding speed and then restoring the normal
speed.

## Entities

The integration creates:

- `fan`: direct speed control
- `number`: normal setpoint, default `57%`
- `number`: feeding setpoint, default `30%`
- `number`: feeding duration, default `10 min`
- `button`: start feeding
- `button`: stop feeding
- `binary_sensor`: feeding active

Pressing `Start feeding` sets the pump to the feeding setpoint for the configured
duration. Afterwards the pump is restored to the normal setpoint. Pressing
`Start feeding` again restarts the timer. Pressing `Stop feeding` immediately
restores the normal setpoint. Setpoints and duration are stored in the
integration options and survive Home Assistant restarts.

## Installation

### HACS custom repository, recommended

This integration can be installed with HACS as a custom repository.

1. Install HACS if you don't have it already.
2. Open HACS in Home Assistant.
3. Open the three-dot menu and choose `Custom repositories`.
4. Add this repository URL:

   ```text
   https://github.com/netrene/ha-jebao-mdc
   ```

5. Choose category `Integration`.
6. Install `JEBAO MDC`.
7. Restart Home Assistant.
8. Add the integration from:

   ```text
   Settings -> Devices & services -> Add integration -> JEBAO MDC
   ```

The setup flow scans the local network via UDP discovery and offers discovered
pumps in a dropdown. If discovery does not find the pump, enter its IP address
manually.

### Manual install

Copy `custom_components/jebao_mdc` into your Home Assistant configuration
directory so the integration is located at:

```text
custom_components/jebao_mdc
```

Restart Home Assistant, then add the integration from:

```text
Settings -> Devices & services -> Add integration -> JEBAO MDC
```

To update a manual installation, replace the folder and restart Home Assistant.

Known values from the first tested pump:

- Host: `192.168.0.80`
- Port: `12416`
- Passcode: leave empty for automatic LAN passcode discovery

The first tested pump returned `BMLEEBSYMF` from the protocol passcode request.
Treat this value as device-specific until more pumps have been tested.

## Protocol notes

The pump uses a Gizwits/GAgent-like local protocol. Useful references:

- https://github.com/tancou/jebao-dosing-pump-md-4.4/blob/main/PROTOCOL.md

The login sequence follows the same broad pattern documented there:

1. Connect to TCP port `12416`.
2. Send message type `06` to request the device passcode.
3. Send message type `08` with the returned 10-byte passcode.
4. Read status or send serial commands via message type `93`.

Device identity is read from UDP discovery responses on port `12414`. The first
tested pump reports:

- Device ID: `1hOqzly1zKe5ruxfXdrLHt`
- MAC: `d8:f1:5b:11:2a:65`
