"""Sensor platform for JEBAO MDC."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import JebaoMdcCoordinator
from .entity import JebaoMdcEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up JEBAO MDC sensor entities."""
    coordinator: JebaoMdcCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            JebaoMdcFeedingRemainingSensor(coordinator, entry),
            JebaoMdcCalibrationStatusSensor(coordinator, entry),
        ]
    )


class JebaoMdcFeedingRemainingSensor(JebaoMdcEntity, SensorEntity):
    """Representation of the remaining feeding time."""

    _attr_name = "Feeding remaining"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "feeding_remaining")

    @property
    def native_value(self) -> int:
        """Return remaining feeding time in seconds."""
        return self.coordinator.feeding_remaining_seconds

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional timer attributes."""
        remaining = self.coordinator.feeding_remaining_seconds
        minutes, seconds = divmod(remaining, 60)
        return {
            "remaining_minutes": minutes,
            "remaining_human": f"{minutes:02d}:{seconds:02d}",
        }


class JebaoMdcCalibrationStatusSensor(JebaoMdcEntity, SensorEntity):
    """Representation of the pump calibration status."""

    _attr_name = "Calibration status"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: JebaoMdcCoordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "calibration_status")

    @property
    def native_value(self) -> str:
        """Return the calibration status."""
        return "calibrated" if self.coordinator.calibrated else "uncalibrated"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return calibration details."""
        return {
            "last_calibrated": self.coordinator.calibration_last,
            "normal_setpoint": self.coordinator.normal_setpoint,
            "feeding_setpoint": self.coordinator.feeding_setpoint,
        }
