"""Data coordinator for JEBAO MDC."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
import time
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_FEEDING_DURATION,
    CONF_FEEDING_SETPOINT,
    CONF_FEEDING_UNTIL,
    CONF_NORMAL_SETPOINT,
    DEFAULT_FEEDING_DURATION,
    DEFAULT_FEEDING_SETPOINT,
    DEFAULT_NORMAL_SETPOINT,
    DOMAIN,
)
from .protocol import JebaoMdcClient, JebaoMdcError, PumpStatus

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=30)


class JebaoMdcCoordinator(DataUpdateCoordinator[PumpStatus]):
    """Coordinate JEBAO MDC status polling."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: JebaoMdcClient,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=SCAN_INTERVAL,
        )
        options = entry.options
        self._entry = entry
        self.client = client
        self.normal_setpoint = int(
            options.get(CONF_NORMAL_SETPOINT, DEFAULT_NORMAL_SETPOINT)
        )
        self.feeding_setpoint = int(
            options.get(CONF_FEEDING_SETPOINT, DEFAULT_FEEDING_SETPOINT)
        )
        self.feeding_duration = int(
            options.get(CONF_FEEDING_DURATION, DEFAULT_FEEDING_DURATION)
        )
        self.feeding_active = False
        self.feeding_until: float | None = self._optional_float(
            options.get(CONF_FEEDING_UNTIL)
        )
        self._feeding_task: asyncio.Task[Any] | None = None

    async def _async_update_data(self) -> PumpStatus:
        """Fetch data from the pump."""
        try:
            return await self.hass.async_add_executor_job(self.client.read_status)
        except (OSError, TimeoutError, JebaoMdcError) as err:
            raise UpdateFailed(str(err)) from err

    async def async_set_speed(self, speed: int) -> None:
        """Set pump speed and refresh coordinator state."""
        try:
            status = await self.hass.async_add_executor_job(
                self.client.set_speed, speed
            )
            if status is None:
                await asyncio.sleep(0.5)
                status = await self.hass.async_add_executor_job(
                    self.client.read_status
                )
        except (OSError, TimeoutError, JebaoMdcError) as err:
            raise UpdateFailed(str(err)) from err

        self.async_set_updated_data(status)

    async def async_start_feeding(self) -> None:
        """Start feeding mode for the configured duration."""
        self.cancel_feeding_timer()
        feeding_until = self._now() + self.feeding_duration * 60
        try:
            await self.async_set_speed(self.feeding_setpoint)
        except Exception:
            self.feeding_active = False
            raise
        else:
            self.feeding_active = True
            self.feeding_until = feeding_until
            self._store_option(CONF_FEEDING_UNTIL, feeding_until)
            self._feeding_task = self.hass.async_create_task(
                self._feeding_timer(feeding_until)
            )
            self.async_update_listeners()

    async def async_stop_feeding(self) -> None:
        """Stop feeding mode and restore the normal setpoint."""
        self.cancel_feeding_timer()
        await self.async_set_speed(self.normal_setpoint)
        self.feeding_active = False
        self.feeding_until = None
        self._remove_option(CONF_FEEDING_UNTIL)
        self.async_update_listeners()

    def cancel_feeding_timer(self) -> None:
        """Cancel the active feeding timer."""
        if self._feeding_task is not None:
            self._feeding_task.cancel()
            self._feeding_task = None

    async def async_restore_feeding_timer(self) -> None:
        """Restore or complete a feeding timer after Home Assistant restart."""
        if self.feeding_until is None:
            return

        remaining = self.feeding_until - self._now()
        if remaining <= 0:
            await self.async_stop_feeding()
            return

        self.feeding_active = True
        self._feeding_task = self.hass.async_create_task(
            self._feeding_timer(self.feeding_until)
        )
        self.async_update_listeners()

    async def _feeding_timer(self, feeding_until: float) -> None:
        """Wait for the feeding duration and restore the normal setpoint."""
        try:
            while True:
                remaining = feeding_until - self._now()
                if remaining <= 0:
                    break
                self.async_update_listeners()
                await asyncio.sleep(min(1, remaining))
            await self.async_set_speed(self.normal_setpoint)
            self.feeding_active = False
            self.feeding_until = None
            self._remove_option(CONF_FEEDING_UNTIL)
            self.async_update_listeners()
        except asyncio.CancelledError:
            raise
        finally:
            if self._feeding_task is asyncio.current_task():
                self._feeding_task = None

    def set_normal_setpoint(self, value: int) -> None:
        """Set the normal speed setpoint."""
        self.normal_setpoint = value
        self.async_update_listeners()

    def set_feeding_setpoint(self, value: int) -> None:
        """Set the feeding speed setpoint."""
        self.feeding_setpoint = value
        self.async_update_listeners()

    def set_feeding_duration(self, value: int) -> None:
        """Set the feeding duration in minutes."""
        self.feeding_duration = value
        self.async_update_listeners()

    def store_normal_setpoint(self, value: int) -> None:
        """Set and persist the normal speed setpoint."""
        self.set_normal_setpoint(value)
        self._store_option(CONF_NORMAL_SETPOINT, value)

    def store_feeding_setpoint(self, value: int) -> None:
        """Set and persist the feeding speed setpoint."""
        self.set_feeding_setpoint(value)
        self._store_option(CONF_FEEDING_SETPOINT, value)

    def store_feeding_duration(self, value: int) -> None:
        """Set and persist the feeding duration."""
        self.set_feeding_duration(value)
        self._store_option(CONF_FEEDING_DURATION, value)

    @property
    def feeding_remaining_seconds(self) -> int:
        """Return remaining feeding time in seconds."""
        if not self.feeding_active or self.feeding_until is None:
            return 0
        return max(0, int(round(self.feeding_until - self._now())))

    def _store_option(self, key: str, value: int | float) -> None:
        """Persist an integration option."""
        options = dict(self._entry.options)
        options[key] = value
        self.hass.config_entries.async_update_entry(self._entry, options=options)

    def _remove_option(self, key: str) -> None:
        """Remove a persisted integration option."""
        options = dict(self._entry.options)
        options.pop(key, None)
        self.hass.config_entries.async_update_entry(self._entry, options=options)

    @staticmethod
    def _optional_float(value: Any) -> float | None:
        """Convert an optional config value to float."""
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _now() -> float:
        """Return the current wall clock timestamp."""
        return time.time()
