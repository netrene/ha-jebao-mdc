"""Number platform for JEBAO MDC."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_FEEDING_DURATION,
    CONF_FEEDING_SETPOINT,
    CONF_NORMAL_SETPOINT,
    DOMAIN,
)
from .coordinator import JebaoMdcCoordinator
from .entity import JebaoMdcEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up JEBAO MDC number entities."""
    coordinator: JebaoMdcCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            JebaoMdcSetpointNumber(
                coordinator,
                entry,
                "normal_setpoint",
                "Normal setpoint",
                "normal_setpoint",
            ),
            JebaoMdcSetpointNumber(
                coordinator,
                entry,
                "feeding_setpoint",
                "Feeding setpoint",
                "feeding_setpoint",
            ),
            JebaoMdcDurationNumber(coordinator, entry),
        ]
    )


class JebaoMdcSetpointNumber(JebaoMdcEntity, NumberEntity):
    """Representation of a speed setpoint."""

    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = "slider"

    def __init__(
        self,
        coordinator: JebaoMdcCoordinator,
        entry: ConfigEntry,
        suffix: str,
        name: str,
        setpoint: str,
    ) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator, entry, suffix)
        self._attr_name = name
        self._setpoint = setpoint

    @property
    def native_value(self) -> int:
        """Return the current setpoint."""
        if self._setpoint == "normal_setpoint":
            return self.coordinator.normal_setpoint
        return self.coordinator.feeding_setpoint

    async def async_set_native_value(self, value: float) -> None:
        """Set the setpoint."""
        setpoint = int(value)
        if self._setpoint == "normal_setpoint":
            self.coordinator.set_normal_setpoint(setpoint)
            self._store_option(CONF_NORMAL_SETPOINT, setpoint)
        else:
            self.coordinator.set_feeding_setpoint(setpoint)
            self._store_option(CONF_FEEDING_SETPOINT, setpoint)


class JebaoMdcDurationNumber(JebaoMdcEntity, NumberEntity):
    """Representation of the feeding duration."""

    _attr_name = "Feeding duration"
    _attr_native_min_value = 1
    _attr_native_max_value = 120
    _attr_native_step = 1
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_mode = "box"

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator, entry, "feeding_duration")

    @property
    def native_value(self) -> int:
        """Return the current feeding duration."""
        return self.coordinator.feeding_duration

    async def async_set_native_value(self, value: float) -> None:
        """Set the feeding duration."""
        duration = int(value)
        self.coordinator.set_feeding_duration(duration)
        self._store_option(CONF_FEEDING_DURATION, duration)
