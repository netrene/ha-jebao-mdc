"""Config flow for JEBAO MDC."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import (
    CONF_DEVICE_ID,
    CONF_MAC,
    CONF_PASSCODE,
    DEFAULT_PASSCODE,
    DEFAULT_PORT,
    DOMAIN,
)
from .protocol import DeviceInfo, JebaoMdcClient, JebaoMdcError, discover_devices


CONF_SELECTED_DEVICE = "selected_device"
MANUAL_DEVICE = "__manual__"


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate user input by reading pump status."""
    client = JebaoMdcClient(
        host=data[CONF_HOST],
        port=data[CONF_PORT],
        passcode=data.get(CONF_PASSCODE, DEFAULT_PASSCODE),
    )

    try:
        await hass.async_add_executor_job(client.read_status)
    except (OSError, TimeoutError, JebaoMdcError) as err:
        raise CannotConnect from err

    try:
        device_info = await hass.async_add_executor_job(client.discover_device_info)
    except (OSError, TimeoutError, JebaoMdcError):
        device_info = None

    result = {"title": f"JEBAO MDC {data[CONF_HOST]}"}
    if device_id := data.get(CONF_DEVICE_ID):
        result[CONF_DEVICE_ID] = device_id
    if mac := data.get(CONF_MAC):
        result[CONF_MAC] = mac

    if device_info is not None:
        result[CONF_DEVICE_ID] = device_info.device_id
        result[CONF_MAC] = device_info.mac

    return result


class JebaoMdcConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for JEBAO MDC."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._discovered_devices: dict[str, DeviceInfo] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            user_input = self._normalize_user_input(user_input, errors)

            if not errors:
                try:
                    info = await validate_input(self.hass, user_input)
                except CannotConnect:
                    errors["base"] = "cannot_connect"
                except Exception:
                    errors["base"] = "unknown"
                else:
                    unique_id = info.get(
                        CONF_DEVICE_ID,
                        f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}",
                    )
                    await self.async_set_unique_id(unique_id)
                    self._abort_if_unique_id_configured()
                    data = {
                        CONF_HOST: user_input[CONF_HOST],
                        CONF_PORT: user_input[CONF_PORT],
                        CONF_PASSCODE: user_input.get(CONF_PASSCODE, DEFAULT_PASSCODE),
                    }
                    if CONF_DEVICE_ID in info:
                        data[CONF_DEVICE_ID] = info[CONF_DEVICE_ID]
                    if CONF_MAC in info:
                        data[CONF_MAC] = info[CONF_MAC]
                    return self.async_create_entry(title=info["title"], data=data)

        if not self._discovered_devices:
            try:
                devices = await self.hass.async_add_executor_job(discover_devices)
            except OSError:
                devices = []
            self._discovered_devices = {device.device_id: device for device in devices}

        return self.async_show_form(
            step_id="user",
            data_schema=self._user_schema(),
            errors=errors,
        )

    def _normalize_user_input(
        self, user_input: dict[str, Any], errors: dict[str, str]
    ) -> dict[str, Any]:
        """Convert a discovered-device selection to normal host data."""
        selected_device = user_input.get(CONF_SELECTED_DEVICE)
        if selected_device and selected_device != MANUAL_DEVICE:
            device = self._discovered_devices.get(selected_device)
            if device is not None:
                return {
                    CONF_HOST: device.host,
                    CONF_PORT: DEFAULT_PORT,
                    CONF_PASSCODE: user_input.get(CONF_PASSCODE, DEFAULT_PASSCODE),
                    CONF_DEVICE_ID: device.device_id,
                    CONF_MAC: device.mac,
                }

        if not user_input.get(CONF_HOST):
            errors[CONF_HOST] = "required"

        return {
            CONF_HOST: user_input.get(CONF_HOST, ""),
            CONF_PORT: user_input.get(CONF_PORT, DEFAULT_PORT),
            CONF_PASSCODE: user_input.get(CONF_PASSCODE, DEFAULT_PASSCODE),
        }

    def _user_schema(self) -> vol.Schema:
        """Return the user form schema."""
        if not self._discovered_devices:
            return vol.Schema(
                {
                    vol.Required(CONF_HOST): str,
                    vol.Optional(CONF_PORT, default=DEFAULT_PORT): int,
                    vol.Optional(CONF_PASSCODE, default=DEFAULT_PASSCODE): str,
                }
            )

        device_options = {
            device_id: f"JEBAO MDC {device.host} ({device.mac})"
            for device_id, device in self._discovered_devices.items()
        }
        device_options[MANUAL_DEVICE] = "Enter IP address manually"
        default_device = next(iter(self._discovered_devices))

        return vol.Schema(
            {
                vol.Required(
                    CONF_SELECTED_DEVICE,
                    default=default_device,
                ): vol.In(device_options),
                vol.Optional(CONF_HOST): str,
                vol.Optional(CONF_PORT, default=DEFAULT_PORT): int,
                vol.Optional(CONF_PASSCODE, default=DEFAULT_PASSCODE): str,
            }
        )


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""
