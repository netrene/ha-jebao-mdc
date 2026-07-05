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

    if (action === "target") {
      this._target = button.dataset.target;
      this._step = this._target === "normal" ? 1 : 2;
      this._selectPump(this._entryId);
      this._render();
      return;
    }

    if (action === "step") {
      this._step = Number(button.dataset.step);
      if (this._step === 1) {
        this._target = "normal";
      }
      if (this._step === 2) {
        this._target = "feeding";
      }
      this._selectPump(this._entryId);
      this._render();
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

  _handleChange(event) {
    const select = event.target.closest("select");
    if (!select) {
      return;
    }

    if (select.name === "pump") {
      this._selectPump(select.value);
      this._step = this._pumps.length > 0 ? 1 : 0;
      this._render();
    }
  }

  async _setCandidate(value) {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

    this._candidate = Math.max(0, Math.min(100, Math.round(value)));
    this._error = "";
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
    }
    this._render();
  }

  async _saveSetpoint() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

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
      this._step = this._target === "normal" ? 2 : 3;
      this._target = this._step === 2 ? "feeding" : this._target;
      this._selectPump(pump.entry_id);
    } catch (error) {
      this._error = error.message || "Could not save setpoint.";
    }
    this._render();
  }

  async _restoreNormal() {
    const pump = this._selectedPump();
    if (!pump) {
      return;
    }

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

  _render() {
    const pump = this._selectedPump();
    const title = pump ? this._escape(pump.title) : "No pump selected";
    const targetLabel =
      this._target === "normal" ? "Normal speed" : "Feeding speed";

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
          max-width: 1180px;
          margin: 0 auto;
          padding: 24px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 20px;
        }

        h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 500;
          letter-spacing: 0;
        }

        .subtitle {
          margin-top: 6px;
          color: var(--secondary-text-color);
          line-height: 1.45;
        }

        .layout {
          display: grid;
          grid-template-columns: 280px minmax(0, 1fr);
          gap: 16px;
        }

        .panel,
        .steps,
        .summary {
          background: var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          box-shadow: var(--ha-card-box-shadow, none);
        }

        .steps {
          padding: 8px;
        }

        .step {
          width: 100%;
          display: grid;
          grid-template-columns: 32px 1fr;
          align-items: center;
          gap: 10px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--primary-text-color);
          text-align: left;
          padding: 12px;
          cursor: pointer;
        }

        .step[aria-current="true"] {
          background: rgba(var(--rgb-primary-color), 0.14);
        }

        .step-index {
          display: inline-grid;
          place-items: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--divider-color);
          font-weight: 600;
        }

        .step[aria-current="true"] .step-index {
          background: var(--primary-color);
          color: var(--text-primary-color);
        }

        .step-title {
          font-weight: 600;
        }

        .step-note {
          color: var(--secondary-text-color);
          font-size: 13px;
          margin-top: 2px;
        }

        .panel {
          padding: 20px;
        }

        .toolbar {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
          margin-bottom: 18px;
        }

        select,
        input {
          min-height: 40px;
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

        .target-switch {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 18px;
        }

        .target-switch button[aria-pressed="true"] {
          background: rgba(var(--rgb-primary-color), 0.14);
          border-color: var(--primary-color);
        }

        .calibration {
          display: grid;
          grid-template-columns: minmax(220px, 0.75fr) minmax(280px, 1fr);
          gap: 20px;
          align-items: stretch;
        }

        .speed-display {
          display: grid;
          place-items: center;
          min-height: 240px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: rgba(var(--rgb-primary-color), 0.06);
        }

        .speed-number {
          font-size: 72px;
          line-height: 1;
          font-weight: 600;
          letter-spacing: 0;
        }

        .speed-label {
          margin-top: 8px;
          color: var(--secondary-text-color);
          text-align: center;
        }

        .controls {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .controls button {
          min-height: 56px;
          font-size: 18px;
        }

        .instructions {
          margin: 0 0 16px;
          line-height: 1.55;
          color: var(--secondary-text-color);
        }

        .actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 16px;
        }

        .summary {
          padding: 16px;
          margin-top: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
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

        .error {
          color: var(--error-color);
          margin-bottom: 12px;
        }

        @media (max-width: 820px) {
          .page {
            padding: 16px;
          }

          .header,
          .layout,
          .calibration,
          .summary-grid {
            grid-template-columns: 1fr;
          }

          .layout {
            display: block;
          }

          .steps {
            margin-bottom: 16px;
          }
        }
      </style>

      <div class="page">
        <div class="header">
          <div>
            <h1>JEBAO MDC calibration</h1>
            <div class="subtitle">
              Find the right normal flow and feeding flow by testing pump speeds step by step.
            </div>
          </div>
          <button data-action="refresh">Refresh</button>
        </div>

        <div class="layout">
          <div class="steps">
            ${this._stepButton(0, "Choose pump", title)}
            ${this._stepButton(1, "Normal speed", "Set the everyday flow")}
            ${this._stepButton(2, "Feeding speed", "Lower flow until feeding works")}
            ${this._stepButton(3, "Review", "Restore and verify")}
          </div>

          <main class="panel">
            ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
            ${this._loading ? `<p class="instructions">Loading pumps...</p>` : ""}
            ${!this._loading && this._pumps.length === 0 ? this._emptyState() : ""}
            ${
              !this._loading && this._pumps.length > 0
                ? this._calibrationView(pump, targetLabel)
                : ""
            }
          </main>
        </div>
      </div>
    `;
  }

  _stepButton(index, title, note) {
    return `
      <button class="step" data-action="step" data-step="${index}" aria-current="${
      this._step === index
    }">
        <span class="step-index">${index + 1}</span>
        <span>
          <span class="step-title">${this._escape(title)}</span>
          <span class="step-note">${this._escape(note)}</span>
        </span>
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

  _calibrationView(pump, targetLabel) {
    return `
      <div class="toolbar">
        <label>
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
      </div>

      <div class="target-switch">
        <button data-action="target" data-target="normal" aria-pressed="${
          this._target === "normal"
        }">Normal speed</button>
        <button data-action="target" data-target="feeding" aria-pressed="${
          this._target === "feeding"
        }">Feeding speed</button>
      </div>

      <p class="instructions">
        ${this._target === "normal"
          ? "Adjust the pump until the aquarium has the normal flow you want every day. Save it when the flow looks right."
          : "Reduce the pump until feeding is calm enough. If this is a return pump, feel whether water still exits where it should. Save the lowest useful value."}
      </p>

      <section class="calibration">
        <div class="speed-display">
          <div>
            <div class="speed-number">${this._candidate}<span style="font-size: 28px;">%</span></div>
            <div class="speed-label">${this._escape(targetLabel)} test value</div>
          </div>
        </div>

        <div>
          <div class="controls">
            <button data-action="adjust" data-delta="-10">-10</button>
            <button data-action="adjust" data-delta="-5">-5</button>
            <button data-action="adjust" data-delta="-1">-1</button>
            <button data-action="adjust" data-delta="1">+1</button>
            <button data-action="adjust" data-delta="5">+5</button>
            <button data-action="adjust" data-delta="10">+10</button>
          </div>

          <div class="actions">
            <button data-action="apply">Apply ${this._candidate}%</button>
            <button class="primary" data-action="save">Save as ${this._escape(targetLabel)}</button>
            <button class="warning" data-action="restore">Restore normal speed</button>
          </div>
        </div>
      </section>

      ${this._summary(pump)}
    `;
  }

  _summary(pump) {
    if (!pump) {
      return "";
    }

    return `
      <section class="summary">
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
      </section>
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
