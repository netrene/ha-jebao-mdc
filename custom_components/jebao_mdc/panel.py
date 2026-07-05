"""Frontend panel and websocket API for JEBAO MDC calibration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.update_coordinator import UpdateFailed

from .const import DOMAIN, PANEL_MODULE_URL, PANEL_URL
from .coordinator import JebaoMdcCoordinator

PANEL_COMPONENT_NAME = "jebao-mdc-calibration-panel"
PANEL_ICON = "mdi:pump"
PANEL_TITLE = "JEBAO Setup"
PANEL_VERSION = "0.4.2"
PANEL_FILE = "frontend/panel.js"

WS_LIST = f"{DOMAIN}/calibration/list"
WS_SET_SPEED = f"{DOMAIN}/calibration/set_speed"
WS_SAVE_SETPOINT = f"{DOMAIN}/calibration/save_setpoint"
WS_RESTORE_NORMAL = f"{DOMAIN}/calibration/restore_normal"

TARGET_NORMAL = "normal"
TARGET_FEEDING = "feeding"

PANEL_REGISTERED = "__panel_registered"
STATIC_REGISTERED = "__static_registered"
WEBSOCKET_REGISTERED = "__websocket_registered"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the calibration panel and its websocket commands."""
    data = hass.data.setdefault(DOMAIN, {})

    if not data.get(STATIC_REGISTERED):
        static_path = Path(__file__).parent / PANEL_FILE
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_MODULE_URL, str(static_path), False)]
        )
        data[STATIC_REGISTERED] = True

    if not data.get(WEBSOCKET_REGISTERED):
        websocket_api.async_register_command(hass, websocket_list_pumps)
        websocket_api.async_register_command(hass, websocket_set_speed)
        websocket_api.async_register_command(hass, websocket_save_setpoint)
        websocket_api.async_register_command(hass, websocket_restore_normal)
        data[WEBSOCKET_REGISTERED] = True

    if PANEL_URL not in hass.data.get("frontend_panels", {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL,
            webcomponent_name=PANEL_COMPONENT_NAME,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{PANEL_MODULE_URL}?v={PANEL_VERSION}",
            config={"domain": DOMAIN},
            require_admin=True,
        )
    data[PANEL_REGISTERED] = True


@callback
def async_unload_panel_if_unused(hass: HomeAssistant) -> None:
    """Remove the panel when no JEBAO MDC entries are loaded."""
    data = hass.data.get(DOMAIN, {})
    if any(isinstance(value, JebaoMdcCoordinator) for value in data.values()):
        return

    if PANEL_URL in hass.data.get("frontend_panels", {}):
        frontend.async_remove_panel(hass, PANEL_URL)
    data.pop(PANEL_REGISTERED, None)


@websocket_api.websocket_command({vol.Required("type"): WS_LIST})
@websocket_api.async_response
async def websocket_list_pumps(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return loaded JEBAO MDC pumps and their calibration values."""
    pumps = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if not isinstance(coordinator, JebaoMdcCoordinator):
            continue

        status = coordinator.data
        pumps.append(
            {
                "entry_id": entry_id,
                "title": coordinator._entry.title,  # noqa: SLF001
                "current_speed": status.speed if status is not None else None,
                "normal_setpoint": coordinator.normal_setpoint,
                "feeding_setpoint": coordinator.feeding_setpoint,
                "feeding_duration": coordinator.feeding_duration,
                "feeding_active": coordinator.feeding_active,
                "feeding_remaining_seconds": coordinator.feeding_remaining_seconds,
            }
        )

    connection.send_result(msg["id"], {"pumps": pumps})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_SET_SPEED,
        vol.Required("entry_id"): cv.string,
        vol.Required("speed"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
    }
)
@websocket_api.async_response
async def websocket_set_speed(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Set the pump speed for calibration testing."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Pump entry not found")
        return

    try:
        await coordinator.async_set_speed(msg["speed"])
    except UpdateFailed as err:
        connection.send_error(msg["id"], "set_speed_failed", str(err))
        return

    connection.send_result(msg["id"], _pump_payload(msg["entry_id"], coordinator))


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_SAVE_SETPOINT,
        vol.Required("entry_id"): cv.string,
        vol.Required("target"): vol.In([TARGET_NORMAL, TARGET_FEEDING]),
        vol.Required("speed"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("restore_normal", default=True): cv.boolean,
    }
)
@websocket_api.async_response
async def websocket_save_setpoint(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist a calibrated normal or feeding setpoint."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Pump entry not found")
        return

    speed = msg["speed"]
    if msg["target"] == TARGET_NORMAL:
        coordinator.store_normal_setpoint(speed)
    else:
        coordinator.store_feeding_setpoint(speed)

    if msg["restore_normal"]:
        try:
            await coordinator.async_set_speed(coordinator.normal_setpoint)
        except UpdateFailed as err:
            connection.send_error(msg["id"], "restore_failed", str(err))
            return

    connection.send_result(msg["id"], _pump_payload(msg["entry_id"], coordinator))


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_RESTORE_NORMAL,
        vol.Required("entry_id"): cv.string,
    }
)
@websocket_api.async_response
async def websocket_restore_normal(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Restore the configured normal setpoint after calibration."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Pump entry not found")
        return

    try:
        await coordinator.async_set_speed(coordinator.normal_setpoint)
    except UpdateFailed as err:
        connection.send_error(msg["id"], "restore_failed", str(err))
        return

    connection.send_result(msg["id"], _pump_payload(msg["entry_id"], coordinator))


def _get_coordinator(
    hass: HomeAssistant,
    entry_id: str,
) -> JebaoMdcCoordinator | None:
    """Return a JEBAO MDC coordinator by config entry ID."""
    coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
    if not isinstance(coordinator, JebaoMdcCoordinator):
        return None
    return coordinator


def _pump_payload(entry_id: str, coordinator: JebaoMdcCoordinator) -> dict[str, Any]:
    """Return a frontend-friendly pump payload."""
    status = coordinator.data
    return {
        "entry_id": entry_id,
        "title": coordinator._entry.title,  # noqa: SLF001
        "current_speed": status.speed if status is not None else None,
        "normal_setpoint": coordinator.normal_setpoint,
        "feeding_setpoint": coordinator.feeding_setpoint,
        "feeding_duration": coordinator.feeding_duration,
        "feeding_active": coordinator.feeding_active,
        "feeding_remaining_seconds": coordinator.feeding_remaining_seconds,
    }
