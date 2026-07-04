# JEBAO MDC Home Assistant custom integration

Experimental Home Assistant custom integration for JEBAO MDC pumps.

## Status

Tested against one MDC-5000 on the local LAN:

- Status read over TCP port `12416`
- Speed set as a Home Assistant `fan` percentage
- Device ID and MAC discovery over UDP port `12414`
- Built-in feeding helper entities

The vendor feeding command is not used. Captures show a feeding-like mode byte,
but the observed device did not visibly enter a feeding pause when the vendor app
sent that command. The integration instead implements feeding by temporarily
setting the pump to a configurable feeding speed and then restoring the normal
speed.

## Entities

The integration creates:

- `fan`: direct speed control
- `number`: normal setpoint, default `57%`
- `number`: feeding setpoint, default `30%`
- `number`: feeding duration, default `10 min`
- `button`: start feeding
- `button`: stop feeding
- `binary_sensor`: feeding active

Pressing `Start feeding` sets the pump to the feeding setpoint for the configured
duration. Afterwards the pump is restored to the normal setpoint. Pressing
`Start feeding` again restarts the timer. Pressing `Stop feeding` immediately
restores the normal setpoint. Setpoints and duration are stored in the
integration options and survive Home Assistant restarts.

## Install for development

Copy `custom_components/jebao_mdc` into your Home Assistant configuration
directory so the integration is located at:

```text
custom_components/jebao_mdc
```

Restart Home Assistant, then add the integration from:

```text
Settings -> Devices & services -> Add integration -> JEBAO MDC
```

The setup flow scans the local network via UDP discovery and offers discovered
pumps in a dropdown. If discovery does not find the pump, enter its IP address
manually.

Known values from the first tested pump:

- Host: `192.168.0.80`
- Port: `12416`
- Passcode: leave empty for automatic LAN passcode discovery

The first tested pump returned `BMLEEBSYMF` from the protocol passcode request.
Treat this value as device-specific until more pumps have been tested.

## HACS

This repository is structured for HACS as a custom integration repository.
Add it to HACS as a custom repository with category `Integration`.

## Protocol notes

The pump uses a Gizwits/GAgent-like local protocol. Useful references:

- https://github.com/tancou/jebao-dosing-pump-md-4.4/blob/main/PROTOCOL.md

The login sequence follows the same broad pattern documented there:

1. Connect to TCP port `12416`.
2. Send message type `06` to request the device passcode.
3. Send message type `08` with the returned 10-byte passcode.
4. Read status or send serial commands via message type `93`.

Device identity is read from UDP discovery responses on port `12414`. The first
tested pump reports:

- Device ID: `1hOqzly1zKe5ruxfXdrLHt`
- MAC: `d8:f1:5b:11:2a:65`
