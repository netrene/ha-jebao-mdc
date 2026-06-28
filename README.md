# JEBAO MDC Home Assistant custom integration

Experimental Home Assistant custom integration for JEBAO MDC pumps.

## Status

Tested against one MDC-5000 on the local LAN:

- Status read over TCP port `12416`
- Speed set as a Home Assistant `fan` percentage

Feeding mode is not exposed yet. Captures show a feeding-like mode byte, but the
observed device did not visibly enter a feeding pause when the vendor app sent
that command.

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

Known values from the first tested pump:

- Host: `192.168.0.80`
- Port: `12416`
- Passcode: `BMLEEBSYMF`

Treat the passcode as device-specific until more pumps have been tested.

## HACS

This repository is structured for HACS as a custom integration repository.
Add it to HACS as a custom repository with category `Integration`.

## Protocol notes

The pump uses a Gizwits/GAgent-like local protocol. Useful references:

- https://github.com/tancou/jebao-dosing-pump-md-4.4/blob/main/PROTOCOL.md
