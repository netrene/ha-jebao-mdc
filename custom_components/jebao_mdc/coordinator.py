"""Data coordinator for JEBAO MDC."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN
from .protocol import JebaoMdcClient, JebaoMdcError, PumpStatus

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=30)


class JebaoMdcCoordinator(DataUpdateCoordinator[PumpStatus]):
    """Coordinate JEBAO MDC status polling."""

    def __init__(self, hass: HomeAssistant, client: JebaoMdcClient) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=SCAN_INTERVAL,
        )
        self.client = client

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
