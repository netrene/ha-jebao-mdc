"""Fan platform for JEBAO MDC."""

from __future__ import annotations

from homeassistant.components.fan import FanEntity, FanEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER, MODEL
from .coordinator import JebaoMdcCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up JEBAO MDC fan entity."""
    coordinator: JebaoMdcCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([JebaoMdcFan(coordinator, entry)])


class JebaoMdcFan(CoordinatorEntity[JebaoMdcCoordinator], FanEntity):
    """Representation of a JEBAO MDC pump as a fan."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_supported_features = FanEntityFeature.SET_SPEED
    _attr_percentage_step = 1

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the fan entity."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.unique_id}_fan"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
            manufacturer=MANUFACTURER,
            model=MODEL,
            name=entry.title,
        )

    @property
    def percentage(self) -> int | None:
        """Return current speed percentage."""
        return self.coordinator.data.speed if self.coordinator.data else None

    @property
    def is_on(self) -> bool | None:
        """Return if pump is running."""
        if self.percentage is None:
            return None
        return self.percentage > 0

    async def async_set_percentage(self, percentage: int) -> None:
        """Set speed percentage."""
        await self.coordinator.async_set_speed(percentage)

    async def async_turn_on(
        self,
        percentage: int | None = None,
        preset_mode: str | None = None,
        **kwargs: object,
    ) -> None:
        """Turn the pump on."""
        await self.async_set_percentage(percentage if percentage is not None else 57)

    async def async_turn_off(self, **kwargs: object) -> None:
        """Turn the pump off by setting speed to 0."""
        await self.async_set_percentage(0)
