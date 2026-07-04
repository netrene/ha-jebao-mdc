"""Button platform for JEBAO MDC."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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
    """Set up JEBAO MDC button entities."""
    coordinator: JebaoMdcCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            JebaoMdcStartFeedingButton(coordinator, entry),
            JebaoMdcStopFeedingButton(coordinator, entry),
        ]
    )


class JebaoMdcStartFeedingButton(JebaoMdcEntity, ButtonEntity):
    """Button that starts feeding mode."""

    _attr_name = "Start feeding"

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the button."""
        super().__init__(coordinator, entry, "start_feeding")

    async def async_press(self) -> None:
        """Handle the button press."""
        await self.coordinator.async_start_feeding()


class JebaoMdcStopFeedingButton(JebaoMdcEntity, ButtonEntity):
    """Button that stops feeding mode."""

    _attr_name = "Stop feeding"

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the button."""
        super().__init__(coordinator, entry, "stop_feeding")

    async def async_press(self) -> None:
        """Handle the button press."""
        await self.coordinator.async_stop_feeding()
