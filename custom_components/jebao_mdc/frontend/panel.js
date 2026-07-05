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
    this._target = "normal";
    this._candidate = 0;
    this._step = 0;
    this._sliderTimer = undefined;
    this._settingSpeed = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) {
      this._load();
      return;
    }
    this._render();
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
    this.shadowRoot.addEventListener("change", (event) => this._handleChange(event));
    this.shadowRoot.addEventListener("input", (event) => this._handleInput(event));
    this._render();
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
      }
      this._loaded = true;
    } catch (error) {
      this._error = error.message || "Could not load pumps.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _selectPump(entryId) {
    this._entryId = entryId;
    const pump = this._selectedPump();
    if (!pump) {
      this._candidate = 0;
      return;
    }
    this._candidate =
      this._target === "normal" ? pump.normal_setpoint : pump.feeding_setpoint;
  }

  _selectedPump() {
    return this._pumps.find((pump) => pump.entry_id === this._entryId);
  }

  async _handleClick(event) {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (!action) {
      return;
    }

    if (action === "refresh") {
      this._loaded = false;
      await this._load();
      return;
    }

    if (action === "step") {
      await this._goToStep(Number(button.dataset.step), { applySpeed: true });
      return;
    }

    if (action === "next") {
      await this._goToStep(Math.min(3, this._step + 1), { applySpeed: true });
      return;
    }

    if (action === "back") {
      await this._goToStep(Math.max(0, this._step - 1), { applySpeed: true });
      return;
    }

    if (action === "adjust") {
      const delta = Number(button.dataset.delta);
      await this._setCandidate(this._candidate + delta);
      return;
    }

    if (action === "apply") {
      await this._setCandidate(this._candidate);
      return;
    }

    if (action === "save") {
      await this._saveSetpoint();
      return;
    }

    if (action === "restore") {
      await this._restoreNormal();
      return;
    }
  }

  async _handleChange(event) {
    const select = event.target.closest("select");
    if (select && select.name === "pump") {
      this._selectPump(select.value);
      await this._goToStep(this._pumps.length > 0 ? 1 : 0, { applySpeed: true });
      return;
    }

    const slider = event.target.closest('input[name="speed"]');
    if (slider) {
      this._cancelSliderTimer();
      await this._setCandidate(slider.value);
    }
  }

  _handleInput(event) {
    const slider = event.target.closest('input[name="speed"]');
    if (!slider) {
      return;
    }

    this._candidate = this._clampSpeed(slider.value);
    this._updateSliderOutput();
    this._cancelSliderTimer();
    this._sliderTimer = window.setTimeout(() => {
      this._setCandidate(this._candidate);
    }, 350);
  }

  async _goToStep(step, options = {}) {
    this._step = step;
    if (step === 1) {
      this._target = "normal";
    }
    if (step === 2) {
      this._target = "feeding";
    }
    this._selectPump(this._entryId);
    this._render();

    if (options.applySpeed && (step === 1 || step === 2)) {
      await this._setCandidate(this._candidate);
    }
  }

  async _setCandidate(value) {
    const pump = this._selectedPump();
    if (!pump || this._settingSpeed) {
      return;
    }

    this._candidate = this._clampSpeed(value);
    this._error = "";
    this._settingSpeed = true;
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/set_speed",
        entry_id: pump.entry_id,
        speed: this._candidate,
      });
      this._mergePump(result);
    } catch (error) {
      this._error = error.message || "Could not set pump speed.";
    } finally {
      this._settingSpeed = false;
    }
    this._render();
  }

  async _saveSetpoint() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

    this._cancelSliderTimer();
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/save_setpoint",
        entry_id: pump.entry_id,
        target: this._target,
        speed: this._candidate,
        restore_normal: true,
      });
      this._mergePump(result);

      if (this._target === "normal") {
        await this._goToStep(2, { applySpeed: true });
      } else {
        await this._goToStep(3, { applySpeed: false });
      }
    } catch (error) {
      this._error = error.message || "Could not save setpoint.";
      this._render();
    }
  }

  async _restoreNormal() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

    this._cancelSliderTimer();
    this._error = "";
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "jebao_mdc/calibration/restore_normal",
        entry_id: pump.entry_id,
      });
      this._mergePump(result);
    } catch (error) {
      this._error = error.message || "Could not restore normal speed.";
    }
    this._render();
  }

  _mergePump(updatedPump) {
    this._pumps = this._pumps.map((pump) =>
      pump.entry_id === updatedPump.entry_id ? updatedPump : pump
    );
  }

  _cancelSliderTimer() {
    if (this._sliderTimer !== undefined) {
      window.clearTimeout(this._sliderTimer);
      this._sliderTimer = undefined;
    }
  }

  _clampSpeed(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value))));
  }

  _updateSliderOutput() {
    const value = String(this._candidate);
    const number = this.shadowRoot.querySelector(".speed-number");
    const slider = this.shadowRoot.querySelector('input[name="speed"]');
    const apply = this.shadowRoot.querySelector('[data-speed-action="apply"]');

    if (number) {
      number.textContent = value;
    }
    if (slider) {
      slider.value = value;
      slider.style.setProperty("--value", `${value}%`);
    }
    if (apply) {
      apply.textContent = `Test ${value}%`;
    }
  }

  _render() {
    const pump = this._selectedPump();
    const title = pump ? this._escape(pump.title) : "No pump selected";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100vh;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        }

        .page {
          max-width: 1120px;
          margin: 0 auto;
          padding: 24px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 22px;
        }

        h1,
        h2,
        h3,
        p {
          margin: 0;
        }

        h1 {
          font-size: 28px;
          font-weight: 500;
          letter-spacing: 0;
        }

        h2 {
          font-size: 24px;
          font-weight: 500;
          letter-spacing: 0;
          margin-bottom: 8px;
        }

        h3 {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0;
          margin-bottom: 10px;
        }

        .subtitle,
        .muted,
        .instructions {
          color: var(--secondary-text-color);
          line-height: 1.5;
        }

        .subtitle {
          margin-top: 6px;
        }

        .progress {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 16px;
        }

        .progress-step {
          min-height: 64px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--ha-card-background, var(--card-background-color));
          color: var(--primary-text-color);
          padding: 10px;
          text-align: left;
          cursor: pointer;
        }

        .progress-step[aria-current="true"] {
          border-color: var(--primary-color);
          background: rgba(var(--rgb-primary-color), 0.14);
        }

        .progress-number {
          display: block;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .progress-title {
          display: block;
          margin-top: 4px;
          font-weight: 600;
        }

        .panel,
        .summary {
          background: var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          box-shadow: var(--ha-card-box-shadow, none);
        }

        .panel {
          padding: 22px;
        }

        .section-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 22px;
          align-items: start;
        }

        .pump-picker {
          display: grid;
          gap: 12px;
          max-width: 420px;
          margin-top: 18px;
        }

        select,
        input {
          min-height: 42px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          padding: 0 10px;
          font: inherit;
        }

        button {
          min-height: 40px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          padding: 0 14px;
          font: inherit;
          cursor: pointer;
        }

        button.primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color);
        }

        button.warning {
          color: var(--error-color);
        }

        button:disabled {
          cursor: progress;
          opacity: 0.65;
        }

        .calibration-grid {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr);
          gap: 24px;
          align-items: center;
          margin-top: 22px;
        }

        .speed-display {
          display: grid;
          place-items: center;
          min-height: 220px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: rgba(var(--rgb-primary-color), 0.08);
        }

        .speed-number-wrap {
          text-align: center;
        }

        .speed-number {
          font-size: 72px;
          line-height: 1;
          font-weight: 600;
          letter-spacing: 0;
        }

        .speed-unit {
          font-size: 28px;
          font-weight: 500;
        }

        .speed-label {
          margin-top: 8px;
          color: var(--secondary-text-color);
          text-align: center;
        }

        .slider-block {
          display: grid;
          gap: 14px;
        }

        .range-wrap {
          position: relative;
          padding-top: 34px;
          padding-bottom: 22px;
        }

        .normal-marker {
          display: none;
          position: absolute;
          top: 0;
          left: var(--normal);
          transform: translateX(-50%);
          color: var(--primary-color);
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .normal-marker::after {
          content: "";
          display: block;
          width: 2px;
          height: 48px;
          margin: 4px auto 0;
          background: var(--primary-color);
          border-radius: 999px;
        }

        .range-wrap.has-marker .normal-marker {
          display: block;
        }

        input[type="range"] {
          width: 100%;
          min-height: 34px;
          padding: 0;
          border: 0;
          accent-color: var(--primary-color);
          background: linear-gradient(
            to right,
            var(--primary-color) 0,
            var(--primary-color) var(--value),
            var(--divider-color) var(--value),
            var(--divider-color) 100%
          );
        }

        .range-labels {
          display: flex;
          justify-content: space-between;
          color: var(--secondary-text-color);
          font-size: 12px;
          margin-top: 4px;
        }

        .quick-controls {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
        }

        .quick-controls button {
          min-height: 44px;
        }

        .actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 18px;
        }

        .summary {
          padding: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }

        .metric {
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          padding: 12px;
        }

        .metric-label {
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        .metric-value {
          margin-top: 6px;
          font-size: 22px;
          font-weight: 600;
        }

        .review-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 18px;
        }

        .error {
          color: var(--error-color);
          margin-bottom: 12px;
        }

        @media (max-width: 820px) {
          .page {
            padding: 16px;
          }

          .header,
          .section-grid,
          .calibration-grid,
          .review-grid {
            grid-template-columns: 1fr;
          }

          .progress {
            grid-template-columns: 1fr 1fr;
          }

          .quick-controls {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      </style>

      <div class="page">
        <div class="header">
          <div>
            <h1>JEBAO MDC calibration</h1>
            <div class="subtitle">Guided setup for normal flow and feeding flow.</div>
          </div>
          <button data-action="refresh">Refresh</button>
        </div>

        ${this._progress(title)}

        <main class="panel">
          ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
          ${this._loading ? `<p class="instructions">Loading pumps...</p>` : ""}
          ${!this._loading && this._pumps.length === 0 ? this._emptyState() : ""}
          ${!this._loading && this._pumps.length > 0 ? this._stepView(pump) : ""}
        </main>
      </div>
    `;
  }

  _progress(pumpTitle) {
    return `
      <nav class="progress" aria-label="Calibration steps">
        ${this._progressButton(0, "Pump", pumpTitle)}
        ${this._progressButton(1, "Normal", "Everyday speed")}
        ${this._progressButton(2, "Feeding", "Reduced speed")}
        ${this._progressButton(3, "Review", "Restore and finish")}
      </nav>
    `;
  }

  _progressButton(index, title, note) {
    return `
      <button class="progress-step" data-action="step" data-step="${index}" aria-current="${
      this._step === index
    }">
        <span class="progress-number">Step ${index + 1}</span>
        <span class="progress-title">${this._escape(title)}</span>
        <span class="muted">${this._escape(note)}</span>
      </button>
    `;
  }

  _emptyState() {
    return `
      <p class="instructions">
        No loaded JEBAO MDC pump was found. Add the integration first or reload this page after setup.
      </p>
    `;
  }

  _stepView(pump) {
    if (this._step === 0) {
      return this._pumpStep(pump);
    }
    if (this._step === 1) {
      return this._speedStep(pump, "normal");
    }
    if (this._step === 2) {
      return this._speedStep(pump, "feeding");
    }
    return this._reviewStep(pump);
  }

  _pumpStep(pump) {
    return `
      <section class="section-grid">
        <div>
          <h2>Select pump</h2>
          <p class="instructions">
            Choose the pump you want to calibrate. The next steps will test speeds on this pump directly.
          </p>

          <label class="pump-picker">
            Pump
            <select name="pump">
              ${this._pumps
                .map(
                  (item) => `
                    <option value="${this._escape(item.entry_id)}" ${
                    item.entry_id === this._entryId ? "selected" : ""
                  }>
                      ${this._escape(item.title)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>

          <div class="actions">
            <button class="primary" data-action="next">Start calibration</button>
          </div>
        </div>

        ${this._summary(pump)}
      </section>
    `;
  }

  _speedStep(pump, target) {
    const isFeeding = target === "feeding";
    const title = isFeeding ? "Set feeding speed" : "Set normal speed";
    const label = isFeeding ? "Feeding speed" : "Normal speed";
    const text = isFeeding
      ? "Move the slider until feeding is calm enough. The normal speed marker stays visible as a reference while the pump runs at the selected feeding speed."
      : "Move the slider until the aquarium has the everyday flow you want. The pump runs at the selected value while you adjust it.";

    return `
      <section>
        <h2>${title}</h2>
        <p class="instructions">${text}</p>

        <div class="calibration-grid">
          <div class="speed-display">
            <div class="speed-number-wrap">
              <span class="speed-number">${this._candidate}</span><span class="speed-unit">%</span>
              <div class="speed-label">${label} test value</div>
            </div>
          </div>

          <div class="slider-block">
            ${this._speedSlider(pump, isFeeding)}

            <div class="quick-controls">
              <button data-action="adjust" data-delta="-10">-10</button>
              <button data-action="adjust" data-delta="-5">-5</button>
              <button data-action="adjust" data-delta="-1">-1</button>
              <button data-action="adjust" data-delta="1">+1</button>
              <button data-action="adjust" data-delta="5">+5</button>
              <button data-action="adjust" data-delta="10">+10</button>
            </div>

            <div class="actions">
              <button data-action="apply" data-speed-action="apply" ${
                this._settingSpeed ? "disabled" : ""
              }>Test ${this._candidate}%</button>
              <button class="primary" data-action="save">Save ${label}</button>
              <button class="warning" data-action="restore">Restore normal speed</button>
              <button data-action="back">Back</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  _speedSlider(pump, showNormalMarker) {
    const markerClass = showNormalMarker ? "range-wrap has-marker" : "range-wrap";
    return `
      <div>
        <div
          class="${markerClass}"
          style="--value: ${this._candidate}%; --normal: ${pump.normal_setpoint}%"
        >
          <div class="normal-marker">Normal ${pump.normal_setpoint}%</div>
          <input
            type="range"
            name="speed"
            min="0"
            max="100"
            step="1"
            value="${this._candidate}"
            style="--value: ${this._candidate}%"
            aria-label="Pump speed"
          >
        </div>
        <div class="range-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    `;
  }

  _reviewStep(pump) {
    return `
      <section>
        <h2>Review calibration</h2>
        <p class="instructions">
          The saved values are ready. Restore normal speed before leaving the wizard.
        </p>

        <div class="review-grid">
          <div class="metric">
            <div class="metric-label">Current pump speed</div>
            <div class="metric-value">${pump.current_speed ?? "-"}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Saved normal speed</div>
            <div class="metric-value">${pump.normal_setpoint}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Saved feeding speed</div>
            <div class="metric-value">${pump.feeding_setpoint}%</div>
          </div>
        </div>

        <div class="actions">
          <button class="primary" data-action="restore">Restore normal speed</button>
          <button data-action="step" data-step="1">Adjust normal speed</button>
          <button data-action="step" data-step="2">Adjust feeding speed</button>
        </div>
      </section>
    `;
  }

  _summary(pump) {
    if (!pump) {
      return "";
    }

    return `
      <aside class="summary">
        <h3>Current setup</h3>
        <div class="summary-grid">
          <div class="metric">
            <div class="metric-label">Current pump speed</div>
            <div class="metric-value">${pump.current_speed ?? "-"}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Saved normal speed</div>
            <div class="metric-value">${pump.normal_setpoint}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Saved feeding speed</div>
            <div class="metric-value">${pump.feeding_setpoint}%</div>
          </div>
        </div>
      </aside>
    `;
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
