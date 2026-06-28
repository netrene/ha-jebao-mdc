"""Config flow for JEBAO MDC."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import CONF_PASSCODE, DEFAULT_PASSCODE, DEFAULT_PORT, DOMAIN
from .protocol import JebaoMdcClient, JebaoMdcError


STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Optional(CONF_PORT, default=DEFAULT_PORT): int,
        vol.Optional(CONF_PASSCODE, default=DEFAULT_PASSCODE): str,
    }
)


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate user input by reading pump status."""
    client = JebaoMdcClient(
        host=data[CONF_HOST],
        port=data[CONF_PORT],
        passcode=data.get(CONF_PASSCODE, DEFAULT_PASSCODE),
    )

    try:
        status = await hass.async_add_executor_job(client.read_status)
    except (OSError, TimeoutError, JebaoMdcError) as err:
        raise CannotConnect from err

    title = f"JEBAO MDC {data[CONF_HOST]}"
    if status.speed is not None:
        title = f"{title} ({status.speed}%)"
    return {"title": title}


class JebaoMdcConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for JEBAO MDC."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                info = await validate_input(self.hass, user_input)
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except Exception:
                errors["base"] = "unknown"
            else:
                unique_id = f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}"
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""

