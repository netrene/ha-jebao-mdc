"""Binary sensor platform for JEBAO MDC."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import JebaoMdcCoordinator
from .entity import JebaoMdcEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up JEBAO MDC binary sensor entities."""
    coordinator: JebaoMdcCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([JebaoMdcFeedingActiveBinarySensor(coordinator, entry)])


class JebaoMdcFeedingActiveBinarySensor(JebaoMdcEntity, BinarySensorEntity):
    """Representation of the feeding active state."""

    _attr_name = "Feeding active"

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the binary sensor."""
        super().__init__(coordinator, entry, "feeding_active")

    @property
    def is_on(self) -> bool:
        """Return if feeding mode is active."""
        return self.coordinator.feeding_active
