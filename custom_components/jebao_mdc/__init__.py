"""The JEBAO MDC integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import CONF_PASSCODE, DEFAULT_PASSCODE, DOMAIN
from .coordinator import JebaoMdcCoordinator
from .protocol import JebaoMdcClient

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.FAN,
    Platform.NUMBER,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JEBAO MDC from a config entry."""
    client = JebaoMdcClient(
        host=entry.data["host"],
        port=entry.data["port"],
        passcode=entry.data.get(CONF_PASSCODE, DEFAULT_PASSCODE),
    )
    coordinator = JebaoMdcCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    await coordinator.async_restore_feeding_timer()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a JEBAO MDC config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        coordinator: JebaoMdcCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        coordinator.cancel_feeding_timer()
    return unload_ok
