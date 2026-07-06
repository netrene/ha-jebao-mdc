class JebaoMdcCalibrationPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._loaded = false;
    this._loading = false;
    this._error = "";
    this._pumps = [];
    this._entryId = "";
    this._step = 1;
    this._done = false;
    this._normal = 57;
    this._feeding = 30;
    this._normalSaved = 57;
    this._feedingSaved = 30;
    this._flash = "";
    this._flashTimer = undefined;
    this._liveTimer = undefined;
    this._liveSeq = 0;
    this._busy = false;
    this._narrow = false;
    this._showFeedingWarning = false;
    this._calibratedEntries = this._loadCalibrationState();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) {
      this._load();
      return;
    }
    this._render();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = Boolean(value);
    this._updateMenuButton();
  }

  get narrow() {
    return this._narrow;
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
    this.shadowRoot.addEventListener("change", (event) => this._handleChange(event));
    this.shadowRoot.addEventListener("input", (event) => this._handleInput(event));
    this._render();
  }

  disconnectedCallback() {
    window.clearTimeout(this._flashTimer);
    window.clearTimeout(this._liveTimer);
  }

  async _load() {
    if (!this._hass) {
      return;
    }

    this._loading = true;
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/list",
      });
      this._pumps = result.pumps || [];
      if (!this._entryId && this._pumps.length > 0) {
        this._selectPump(this._pumps[0].entry_id);
      } else {
        this._syncFromPump();
      }
      this._loaded = true;
    } catch (error) {
      this._error = error.message || "Pumpen konnten nicht geladen werden.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _selectPump(entryId) {
    this._entryId = entryId;
    this._syncFromPump();
  }

  _syncFromPump() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }
    this._normal = this._clampSpeed(pump.normal_setpoint);
    this._feeding = this._clampSpeed(pump.feeding_setpoint);
    this._normalSaved = this._normal;
    this._feedingSaved = this._feeding;
  }

  _selectedPump() {
    return this._pumps.find((pump) => pump.entry_id === this._entryId);
  }

  async _handleClick(event) {
    const target = event.target;
    const button = target.closest("button");
    if (button?.dataset.action) {
      await this._runAction(button.dataset.action, button.dataset);
      return;
    }

    const link = target.closest("[data-action]");
    if (link?.dataset.action) {
      await this._runAction(link.dataset.action, link.dataset);
    }
  }

  async _runAction(action, dataset) {
    if (this._busy && action !== "back") {
      return;
    }

    if (action === "next") {
      await this._next();
      return;
    }
    if (action === "confirm-feeding-warning") {
      await this._continueToFeedingStep();
      return;
    }
    if (action === "cancel-feeding-warning") {
      this._showFeedingWarning = false;
      this._render();
      return;
    }
    if (action === "back") {
      await this._back();
      return;
    }
    if (action === "restart") {
      await this._restart();
      return;
    }
    if (action === "adjust-step") {
      await this._goToStep(Number(dataset.step), { applySpeed: true });
      return;
    }
    if (action === "menu") {
      this.dispatchEvent(
        new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
      );
    }
  }

  async _handleChange(event) {
    const select = event.target.closest("select");
    if (select?.name === "pump") {
      this._selectPump(select.value);
      this._render();
      return;
    }

    const input = event.target.closest('input[name="speed"]');
    if (input) {
      this._cancelLiveTimer();
      await this._sendLiveSpeed(this._clampSpeed(input.value));
    }
  }

  _handleInput(event) {
    const input = event.target.closest('input[name="speed"]');
    if (!input || (this._step !== 2 && this._step !== 3)) {
      return;
    }

    this._setActiveValue(input.value);
  }

  async _goToStep(step, options = {}) {
    this._done = false;
    this._step = Math.max(1, Math.min(4, step));
    this._flash = "";
    this._render();

    if (options.applySpeed && (this._step === 2 || this._step === 3)) {
      await this._sendLiveSpeed(this._activeValue());
    }
  }

  async _next() {
    if (this._done) {
      return;
    }

    if (this._step === 1) {
      await this._goToStep(2, { applySpeed: true });
      return;
    }

    if (this._step === 2) {
      this._showFeedingWarning = true;
      this._render();
      return;
    }

    if (this._step === 3) {
      if (!(await this._saveSetpoint("feeding", this._feeding))) {
        return;
      }
      this._feedingSaved = this._feeding;
      this._step = 4;
      this._flashMessage("Feeding gespeichert");
      this._render();
      return;
    }

    await this._finish();
  }

  async _continueToFeedingStep() {
    this._showFeedingWarning = false;
    if (!(await this._saveSetpoint("normal", this._normal))) {
      return;
    }
    this._normalSaved = this._normal;
    this._step = 3;
    this._flashMessage("Normaldrehzahl gespeichert");
    this._render();
    await this._sendLiveSpeed(this._feeding);
  }

  async _back() {
    if (this._done) {
      await this._goToStep(4);
      return;
    }

    await this._goToStep(this._step - 1, { applySpeed: true });
  }

  async _restart() {
    this._done = false;
    this._step = 1;
    this._syncFromPump();
    this._normal = this._normalSaved;
    this._feeding = this._feedingSaved;
    this._flash = "";
    this._render();
  }

  async _finish() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

    this._cancelLiveTimer();
    this._busy = true;
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/restore_normal",
        entry_id: pump.entry_id,
      });
      this._mergePump(result);
      this._syncFromPump();
      this._markCalibrated(pump.entry_id);
      this._done = true;
      this._flash = "";
    } catch (error) {
      this._error = error.message || "Normaldrehzahl konnte nicht wiederhergestellt werden.";
    } finally {
      this._busy = false;
      this._render();
    }
  }

  async _saveSetpoint(target, speed) {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

    this._cancelLiveTimer();
    this._busy = true;
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/save_setpoint",
        entry_id: pump.entry_id,
        target,
        speed,
        restore_normal: false,
      });
      this._mergePump(result);
      return true;
    } catch (error) {
      this._error = error.message || "Sollwert konnte nicht gespeichert werden.";
      return false;
    } finally {
      this._busy = false;
      this._render();
    }
  }

  _setActiveValue(value) {
    const speed = this._clampSpeed(value);
    if (this._step === 2) {
      this._normal = speed;
    } else {
      this._feeding = speed;
    }
    this._render();
    this._scheduleLiveSpeed(speed);
  }

  _scheduleLiveSpeed(speed) {
    this._cancelLiveTimer();
    this._liveTimer = window.setTimeout(() => this._sendLiveSpeed(speed), 180);
  }

  async _sendLiveSpeed(speed) {
    const pump = this._selectedPump();
    if (!pump || !this._hass) {
      return;
    }

    const seq = ++this._liveSeq;
    this._error = "";

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/set_speed",
        entry_id: pump.entry_id,
        speed,
      });
      if (seq === this._liveSeq) {
        this._mergePump(result);
      }
    } catch (error) {
      if (seq === this._liveSeq) {
        this._error = error.message || "Pumpendrehzahl konnte nicht gesetzt werden.";
      }
    }
    if (seq === this._liveSeq) {
      this._render();
    }
  }

  _mergePump(updatedPump) {
    this._pumps = this._pumps.map((pump) =>
      pump.entry_id === updatedPump.entry_id ? updatedPump : pump
    );
  }

  _cancelLiveTimer() {
    if (this._liveTimer !== undefined) {
      window.clearTimeout(this._liveTimer);
      this._liveTimer = undefined;
    }
  }

  _flashMessage(message) {
    this._flash = message;
    window.clearTimeout(this._flashTimer);
    this._flashTimer = window.setTimeout(() => {
      this._flash = "";
      this._render();
    }, 2400);
  }

  _clampSpeed(value) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(100, number));
  }

  _activeValue() {
    return this._step === 2 ? this._normal : this._feeding;
  }

  _title() {
    if (this._step === 1) {
      return ["SCHRITT 1 · PUMPE", "Pumpe auswählen"];
    }
    if (this._step === 2) {
      return ["SCHRITT 2 · NORMALBETRIEB", "Normaldrehzahl einstellen"];
    }
    if (this._step === 3) {
      return ["SCHRITT 3 · FEEDING", "Feeding-Drehzahl einstellen"];
    }
    return ["SCHRITT 4 · ÜBERPRÜFEN", "Werte überprüfen"];
  }

  _helperText() {
    if (this._step === 1) {
      return "Wähle die Pumpe, die kalibriert werden soll. Die nächsten Schritte testen die Geschwindigkeiten direkt an dieser Pumpe.";
    }
    if (this._step === 2) {
      return "Stelle die Strömung ein, die das Aquarium im Alltag haben soll. Die Pumpe läuft live mit dem eingestellten Wert.";
    }
    if (this._step === 3) {
      return "Reduziere die Drehzahl der Pumpe so weit, dass kaum oder kein Wasser mehr ins Aquarium gefördert wird, aber die Leitung nicht komplett leerläuft.";
    }
    return "Kontrolliere Normal- und Feeding-Wert. Mit Abschließen werden sie gespeichert und die Normaldrehzahl wiederhergestellt.";
  }

  _primaryLabel() {
    if (this._done) {
      return "Zur Pumpenauswahl";
    }
    if (this._step === 1) {
      return "Weiter";
    }
    if (this._step === 4) {
      return "Abschließen";
    }
    return "Speichern & weiter";
  }

  _pumpLabel(pump) {
    if (!pump) {
      return "Keine Pumpe gefunden";
    }
    return pump.title.replace("JEBAO MDC ", "JEBAO MDC · ");
  }

  _isCalibrated(entryId) {
    return this._calibratedEntries.has(entryId);
  }

  _markCalibrated(entryId) {
    this._calibratedEntries.add(entryId);
    this._saveCalibrationState();
  }

  _loadCalibrationState() {
    try {
      const raw = window.localStorage.getItem("jebao_mdc_calibrated_entries");
      const values = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(values) ? values : []);
    } catch (_error) {
      return new Set();
    }
  }

  _saveCalibrationState() {
    try {
      window.localStorage.setItem(
        "jebao_mdc_calibrated_entries",
        JSON.stringify([...this._calibratedEntries])
      );
    } catch (_error) {
      // Calibration setpoints are saved in Home Assistant; this only affects UI status.
    }
  }

  _render() {
    const pump = this._selectedPump();
    const [kicker, title] = this._title();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --jebao-primary: var(--primary-color, #03a9f4);
          --jebao-primary-text: var(--text-primary-color, #05131c);
          --jebao-card: var(--ha-card-background, var(--card-background-color, #1b1b1b));
          --jebao-panel: #181818;
          --jebao-flow: #101418;
          --jebao-text: var(--primary-text-color, #eaeaea);
          --jebao-muted: var(--secondary-text-color, #9a9a9a);
          --jebao-border: rgba(255, 255, 255, 0.09);
          display: block;
          min-height: 100vh;
          color: var(--jebao-text);
          background: var(--primary-background-color, #111);
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        h1,
        p {
          margin: 0;
        }

        .page {
          min-height: 100vh;
          display: grid;
          place-items: start center;
          padding: 34px 18px;
        }

        .menu-button {
          position: fixed;
          top: 8px;
          left: 8px;
          z-index: 2;
          width: 44px;
          height: 44px;
          display: none;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: var(--primary-text-color, #eaeaea);
          padding: 0;
        }

        .menu-icon,
        .menu-icon::before,
        .menu-icon::after {
          display: block;
          width: 20px;
          height: 2px;
          border-radius: 99px;
          background: currentColor;
        }

        .menu-icon {
          position: relative;
        }

        .menu-icon::before,
        .menu-icon::after {
          content: "";
          position: absolute;
          left: 0;
        }

        .menu-icon::before {
          top: -6px;
        }

        .menu-icon::after {
          top: 6px;
        }

        .wizard {
          width: 600px;
          max-width: 100%;
          background: var(--jebao-card);
          border: 1px solid var(--jebao-border);
          border-radius: 18px;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
          color: var(--jebao-text);
          overflow: hidden;
        }

        .header {
          padding: 24px 26px 8px;
        }

        .kicker {
          color: var(--jebao-primary);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.4px;
        }

        h1 {
          margin-top: 6px;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: 0;
        }

        .stepper {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 18px;
        }

        .dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: rgba(255, 255, 255, 0.14);
          color: #9a9a9a;
          font-size: 12px;
          font-weight: 700;
        }

        .dot.active {
          background: var(--jebao-primary);
          color: #05131c;
        }

        .line {
          flex: 1;
          height: 2px;
          background: rgba(255, 255, 255, 0.14);
        }

        .line.active {
          background: var(--jebao-primary);
        }

        .content {
          min-height: 320px;
          padding: 22px 26px 24px;
        }

        .helper {
          color: var(--jebao-muted);
          font-size: 14px;
          line-height: 1.55;
          margin-bottom: 22px;
        }

        .field {
          display: grid;
          gap: 8px;
        }

        .pump-status-list {
          display: grid;
          gap: 8px;
          margin-top: 16px;
        }

        .pump-status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 46px;
          background: var(--jebao-panel);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 12px;
        }

        .pump-status-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #e6e6e6;
          font-size: 13px;
        }

        .status-chip {
          flex: 0 0 auto;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 0.2px;
          padding: 5px 9px;
        }

        .status-chip.calibrated {
          background: rgba(76, 175, 80, 0.16);
          border: 1px solid rgba(76, 175, 80, 0.42);
          color: #a8e6aa;
        }

        .status-chip.uncalibrated {
          background: rgba(255, 193, 7, 0.12);
          border: 1px solid rgba(255, 193, 7, 0.34);
          color: #ffd978;
        }

        label,
        .field-label {
          color: var(--jebao-muted);
          font-size: 13px;
        }

        select,
        input[type="number"] {
          width: 100%;
          min-height: 46px;
          background: var(--jebao-panel);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 10px;
          color: #eee;
          font: inherit;
          padding: 0 14px;
        }

        .info {
          margin-top: 16px;
          background: rgba(3, 169, 244, 0.08);
          border: 1px solid rgba(3, 169, 244, 0.22);
          border-radius: 10px;
          color: #bfe3f5;
          font-size: 13px;
          line-height: 1.5;
          padding: 12px 14px;
        }

        .flowbox {
          height: 118px;
          border-radius: 14px;
          overflow: hidden;
          background: var(--jebao-flow);
          border: 1px solid rgba(255, 255, 255, 0.07);
          margin-bottom: 22px;
          position: relative;
        }

        .flow {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            112deg,
            rgba(3, 169, 244, 0) 0 15px,
            rgba(3, 169, 244, 0.4) 15px 24px
          );
          animation: flowmove var(--flow-duration) linear infinite;
          opacity: var(--flow-opacity);
        }

        .flow-value {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          text-align: center;
        }

        .speed {
          color: #fff;
          font-size: 56px;
          font-weight: 800;
          line-height: 1;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
        }

        .speed span {
          color: #d5eefb;
          font-size: 22px;
        }

        .speed-label {
          color: #cfe8f7;
          font-size: 12px;
          letter-spacing: 1px;
          margin-top: 6px;
          text-transform: uppercase;
        }

        .slider-wrap {
          position: relative;
          padding-top: 14px;
        }

        input[type="range"] {
          width: 100%;
          accent-color: var(--jebao-primary);
        }

        .normal-marker {
          position: absolute;
          top: -8px;
          left: var(--normal-left);
          transform: translateX(-50%);
          color: var(--jebao-primary);
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
        }

        .normal-marker::after {
          content: "";
          display: block;
          width: 2px;
          height: 34px;
          margin: 3px auto 0;
          background: var(--jebao-primary);
          border-radius: 99px;
        }

        .scale {
          display: flex;
          justify-content: space-between;
          color: #6a6a6a;
          font-size: 11px;
          margin-top: 5px;
        }

        .number-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 20px;
          color: var(--jebao-muted);
          font-size: 13px;
        }

        .number-row input {
          width: 88px;
          border-radius: 8px;
          font-size: 16px;
          text-align: center;
        }

        .review-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .value-card {
          background: var(--jebao-panel);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
        }

        .value-label {
          color: #8a8a8a;
          font-size: 12px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .value {
          margin-top: 8px;
          font-size: 34px;
          font-weight: 800;
        }

        .text-link {
          display: inline-block;
          margin-top: 10px;
          border: 0;
          background: transparent;
          color: var(--jebao-primary);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          padding: 0;
        }

        .pump-line {
          margin-top: 14px;
          color: var(--jebao-muted);
          font-size: 13px;
        }

        .pump-line strong {
          color: #cfcfcf;
        }

        .done {
          display: grid;
          justify-items: center;
          padding: 32px 0 20px;
          text-align: center;
        }

        .check {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: rgba(3, 169, 244, 0.15);
          border: 2px solid var(--jebao-primary);
          color: var(--jebao-primary);
          font-size: 30px;
        }

        .done-title {
          margin-top: 18px;
          font-size: 20px;
          font-weight: 700;
        }

        .done-text {
          max-width: 390px;
          margin-top: 8px;
          color: var(--jebao-muted);
          font-size: 14px;
          line-height: 1.5;
        }

        .footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          min-height: 73px;
          padding: 16px 26px;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
        }

        button {
          min-height: 44px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: transparent;
          color: #b9b9b9;
          cursor: pointer;
          font: inherit;
          font-size: 14px;
          font-weight: 500;
          padding: 0 18px;
        }

        button.primary {
          min-height: 46px;
          background: var(--jebao-primary);
          border-color: var(--jebao-primary);
          color: #05131c;
          font-size: 15px;
          font-weight: 700;
          padding: 0 22px;
        }

        button.back {
          margin-right: auto;
        }

        button:disabled {
          cursor: progress;
          opacity: 0.65;
        }

        .flash {
          color: var(--jebao-primary);
          font-size: 13px;
          font-weight: 600;
        }

        .error,
        .empty {
          color: var(--error-color, #ff6b6b);
          font-size: 14px;
          line-height: 1.5;
        }

        .empty {
          color: var(--jebao-muted);
        }

        .dialog-backdrop {
          position: fixed;
          inset: 0;
          z-index: 5;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(0, 0, 0, 0.62);
        }

        .warning-dialog {
          width: 460px;
          max-width: 100%;
          background: #1d1515;
          border: 1px solid rgba(255, 82, 82, 0.55);
          border-radius: 16px;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
          color: #f5eeee;
          padding: 22px;
        }

        .warning-head {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .alarm {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border-radius: 50%;
          background: rgba(255, 82, 82, 0.16);
          border: 2px solid #ff5252;
          color: #ff6b6b;
          font-size: 28px;
          font-weight: 900;
        }

        .warning-title {
          font-size: 20px;
          font-weight: 750;
        }

        .warning-text {
          margin-top: 14px;
          color: #f2caca;
          font-size: 14px;
          line-height: 1.55;
        }

        .warning-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }

        button.danger {
          background: #ff5252;
          border-color: #ff5252;
          color: #1b0909;
          font-weight: 750;
        }

        @keyframes flowmove {
          from {
            background-position: 0 0;
          }
          to {
            background-position: 90px 0;
          }
        }

        @media (max-width: 640px) {
          :host {
            height: 100vh;
            height: 100dvh;
            min-height: 0;
            overflow: hidden;
          }

          .page {
            height: 100vh;
            height: 100dvh;
            min-height: 0;
            padding: 8px;
            padding-top: 54px;
            place-items: stretch;
          }

          .wizard {
            width: 100%;
            height: calc(100vh - 62px);
            height: calc(100dvh - 62px);
            max-height: calc(100vh - 62px);
            max-height: calc(100dvh - 62px);
            display: flex;
            flex-direction: column;
            border-radius: 14px;
            overflow: hidden;
          }

          .header,
          .content,
          .footer {
            padding-left: 14px;
            padding-right: 14px;
          }

          .header {
            flex: 0 0 auto;
            padding-top: 16px;
            padding-bottom: 8px;
          }

          .kicker {
            font-size: 10px;
            letter-spacing: 1.1px;
          }

          h1 {
            font-size: 21px;
            line-height: 1.15;
          }

          .stepper {
            gap: 5px;
            margin-top: 12px;
          }

          .dot {
            width: 20px;
            height: 20px;
            font-size: 11px;
          }

          .content {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            padding-top: 14px;
            padding-bottom: 14px;
          }

          .helper {
            font-size: 13px;
            line-height: 1.42;
            margin-bottom: 12px;
          }

          select,
          input[type="number"] {
            min-height: 40px;
            border-radius: 8px;
          }

          .info {
            margin-top: 12px;
            padding: 10px 12px;
            font-size: 12px;
            line-height: 1.38;
          }

          .flowbox {
            height: 88px;
            border-radius: 11px;
            margin-bottom: 14px;
          }

          .speed {
            font-size: 42px;
          }

          .speed span {
            font-size: 18px;
          }

          .speed-label {
            font-size: 10px;
            margin-top: 4px;
          }

          .slider-wrap {
            padding-top: 10px;
          }

          input[type="range"] {
            margin: 0;
          }

          .normal-marker {
            top: -7px;
            font-size: 9px;
          }

          .normal-marker::after {
            height: 27px;
          }

          .number-row {
            margin-top: 12px;
          }

          .number-row input {
            width: 76px;
            font-size: 15px;
          }

          .value-card {
            padding: 12px;
          }

          .value {
            font-size: 28px;
          }

          .pump-line {
            margin-top: 10px;
          }

          .review-grid {
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .done {
            align-content: center;
            min-height: 100%;
            padding: 16px 0;
          }

          .check {
            width: 54px;
            height: 54px;
            font-size: 26px;
          }

          .done-title {
            font-size: 18px;
          }

          .footer {
            flex: 0 0 auto;
            min-height: 60px;
            padding-top: 8px;
            padding-bottom: 8px;
            gap: 8px;
            background: var(--jebao-card);
          }

          button {
            min-height: 40px;
            border-radius: 9px;
            padding: 0 13px;
            font-size: 13px;
          }

          button.primary {
            min-height: 42px;
            padding: 0 15px;
            font-size: 14px;
          }

          .flash {
            max-width: 120px;
            font-size: 12px;
            line-height: 1.2;
          }

          .dialog-backdrop {
            padding: 12px;
          }

          .warning-dialog {
            padding: 18px;
          }

          .warning-title {
            font-size: 18px;
          }

          .warning-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .warning-actions button {
            width: 100%;
          }
        }
      </style>

      <button class="menu-button" data-action="menu" aria-label="Menü öffnen">
        <span class="menu-icon" aria-hidden="true"></span>
      </button>
      <div class="page">
        <main class="wizard" aria-live="polite">
          ${
            this._done
              ? this._doneView()
              : `
                <header class="header">
                  <div class="kicker">${kicker}</div>
                  <h1>${title}</h1>
                  ${this._stepper()}
                </header>
                <section class="content">
                  ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
                  ${this._loading ? `<p class="empty">Pumpen werden geladen...</p>` : ""}
                  ${!this._loading && this._pumps.length === 0 ? this._emptyView() : ""}
                  ${!this._loading && this._pumps.length > 0 ? this._stepView(pump) : ""}
                </section>
              `
          }
          ${this._footer()}
        </main>
      </div>
      ${this._showFeedingWarning ? this._feedingWarningDialog() : ""}
    `;
    this._updateMenuButton();
  }

  _stepper() {
    return `
      <div class="stepper" aria-label="Kalibrier-Schritte">
        ${[1, 2, 3, 4]
          .map((step) => {
            const active = step <= this._step ? " active" : "";
            const line =
              step < 4 ? `<div class="line${step + 1 <= this._step ? " active" : ""}"></div>` : "";
            return `<div class="dot${active}">${step}</div>${line}`;
          })
          .join("")}
      </div>
    `;
  }

  _stepView(pump) {
    if (this._step === 1) {
      return this._pumpStep(pump);
    }
    if (this._step === 2 || this._step === 3) {
      return this._speedStep();
    }
    return this._reviewStep(pump);
  }

  _pumpStep(pump) {
    return `
      <p class="helper">${this._helperText()}</p>
      <div class="field">
        <label for="pump">Gefundene Pumpe</label>
        <select id="pump" name="pump">
          ${this._pumps
            .map(
              (item) => `
                <option value="${this._escape(item.entry_id)}" ${
                item.entry_id === this._entryId ? "selected" : ""
              }>
                  ${this._escape(this._pumpLabel(item))} · ${
                this._isCalibrated(item.entry_id) ? "Kalibriert" : "Unkalibriert"
              }
                </option>
              `
            )
            .join("")}
        </select>
      </div>
      <div class="info">
        In den nächsten Schritten läuft die Pumpe <strong>live</strong> mit dem eingestellten Wert,
        so siehst du die Strömung sofort.
      </div>
      <div class="pump-status-list" aria-label="Kalibrierstatus">
        ${this._pumps
          .map((item) => {
            const calibrated = this._isCalibrated(item.entry_id);
            return `
              <div class="pump-status-row">
                <div class="pump-status-name">${this._escape(this._pumpLabel(item))}</div>
                <div class="status-chip ${calibrated ? "calibrated" : "uncalibrated"}">
                  ${calibrated ? "Kalibriert" : "Unkalibriert"}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
      ${pump ? `<div class="pump-line">Aktuell: <strong>${pump.current_speed ?? "-"}%</strong></div>` : ""}
    `;
  }

  _speedStep() {
    const value = this._activeValue();
    const isFeeding = this._step === 3;
    const duration = Math.max(0.45, 2.4 - (value / 100) * 1.95).toFixed(2);
    const opacity = (0.28 + (value / 100) * 0.62).toFixed(2);

    return `
      <p class="helper">${this._helperText()}</p>
      <div class="flowbox" style="--flow-duration:${duration}s; --flow-opacity:${opacity}">
        <div class="flow"></div>
        <div class="flow-value">
          <div>
            <div class="speed">${value}<span>%</span></div>
            <div class="speed-label">${isFeeding ? "Feeding-Testwert" : "Normal-Testwert"}</div>
          </div>
        </div>
      </div>
      <div class="slider-wrap" style="--normal-left:${this._normalSaved}%">
        ${isFeeding ? `<div class="normal-marker">Normal ${this._normalSaved}%</div>` : ""}
        <input
          type="range"
          name="speed"
          min="0"
          max="100"
          step="1"
          value="${value}"
          aria-label="${isFeeding ? "Feeding-Drehzahl" : "Normaldrehzahl"}"
        >
        <div class="scale">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
      <label class="number-row">
        <span>Wert:</span>
        <input type="number" name="speed" min="0" max="100" value="${value}">
        <span>%</span>
      </label>
    `;
  }

  _reviewStep(pump) {
    return `
      <p class="helper">${this._helperText()}</p>
      <div class="review-grid">
        <div class="value-card">
          <div class="value-label">Normaldrehzahl</div>
          <div class="value">${this._normalSaved}%</div>
          <button class="text-link" data-action="adjust-step" data-step="2">Anpassen</button>
        </div>
        <div class="value-card">
          <div class="value-label">Feeding</div>
          <div class="value">${this._feedingSaved}%</div>
          <button class="text-link" data-action="adjust-step" data-step="3">Anpassen</button>
        </div>
      </div>
      <div class="pump-line">Pumpe: <strong>${this._escape(this._pumpLabel(pump))}</strong></div>
      <div class="info">
        Beim Abschließen wird die <strong>Normaldrehzahl (${this._normalSaved}%)</strong>
        automatisch wiederhergestellt.
      </div>
    `;
  }

  _doneView() {
    return `
      <section class="content done">
        <div class="check">✓</div>
        <div class="done-title">Kalibrierung abgeschlossen</div>
        <p class="done-text">
          Normaldrehzahl (${this._normalSaved}%) wurde automatisch wiederhergestellt.
          Feeding ist gespeichert. Du kannst jetzt zur Pumpenauswahl zurückkehren
          und die nächste Pumpe kalibrieren.
        </p>
      </section>
    `;
  }

  _emptyView() {
    return `
      <p class="empty">
        Keine geladene JEBAO MDC Pumpe gefunden. Füge die Integration zuerst hinzu oder lade
        Home Assistant nach dem Setup neu.
      </p>
    `;
  }

  _footer() {
    const primaryAction = this._done ? "restart" : "next";
    const showBack = !this._done && this._step > 1;

    return `
      <footer class="footer">
        ${showBack ? `<button class="back" data-action="back">Zurück</button>` : ""}
        ${this._flash ? `<span class="flash">✓ ${this._escape(this._flash)}</span>` : ""}
        <button
          class="primary"
          data-action="${primaryAction}"
          ${this._busy || this._loading || (!this._loading && this._pumps.length === 0 && !this._done) ? "disabled" : ""}
        >
          ${this._primaryLabel()}
        </button>
      </footer>
    `;
  }

  _feedingWarningDialog() {
    return `
      <div class="dialog-backdrop" role="presentation">
        <section
          class="warning-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="feeding-warning-title"
        >
          <div class="warning-head">
            <div class="alarm" aria-hidden="true">!</div>
            <div id="feeding-warning-title" class="warning-title">Drehzahl wird reduziert</div>
          </div>
          <p class="warning-text">
            Im nächsten Schritt wird die Pumpe auf den Feeding-Testwert reduziert.
            Bitte befinde dich in der Nähe des Aquariums und kontrolliere Wasserstand
            sowie Wasseraustritt, bevor du fortfährst.
          </p>
          <div class="warning-actions">
            <button data-action="cancel-feeding-warning">Abbrechen</button>
            <button class="danger" data-action="confirm-feeding-warning">
              Verstanden, weiter
            </button>
          </div>
        </section>
      </div>
    `;
  }

  _updateMenuButton() {
    const menuButton = this.shadowRoot.querySelector(".menu-button");
    if (menuButton) {
      menuButton.style.display = this._narrow ? "grid" : "none";
    }
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("jebao-mdc-calibration-panel", JebaoMdcCalibrationPanel);
