"""Shared entity helpers for JEBAO MDC."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_MAC, DOMAIN, MANUFACTURER, MODEL
from .coordinator import JebaoMdcCoordinator


class JebaoMdcEntity(CoordinatorEntity[JebaoMdcCoordinator]):
    """Base class for JEBAO MDC entities."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: JebaoMdcCoordinator,
        entry: ConfigEntry,
        suffix: str,
    ) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.unique_id}_{suffix}"

        device_info: DeviceInfo = {
            "identifiers": {(DOMAIN, entry.unique_id or entry.entry_id)},
            "manufacturer": MANUFACTURER,
            "model": MODEL,
            "name": entry.title,
        }
        if mac := entry.data.get(CONF_MAC):
            device_info["connections"] = {(dr.CONNECTION_NETWORK_MAC, mac)}

        self._attr_device_info = device_info

    def _store_option(self, key: str, value: int) -> None:
        """Persist an integration option."""
        options = dict(self._entry.options)
        options[key] = value
        self.hass.config_entries.async_update_entry(self._entry, options=options)
