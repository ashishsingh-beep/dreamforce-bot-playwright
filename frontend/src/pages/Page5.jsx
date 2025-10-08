// Example: Page5.js
import React, { useState } from "react";
import "../styles/page5.css";
// Save the provided screenshot to src/assets/anydesk-guide.png
import guideImg from "../assets/anydesk-guide.png";
import config from "../../config/config";

// Default credentials (can be overridden via .env and config.js)
const DEFAULT_ADDRESS = config.defaultAnyDeskAddress || "1 196 364 788";
const DEFAULT_PASSWORD = config.defaultAnyDeskPassword || "remote@123";

function RemoteAccess() {
  const [message, setMessage] = useState(null);

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copied to clipboard`);
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setMessage("Unable to copy to clipboard");
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const openAnyDesk = () => {
    // open AnyDesk website to prompt user to launch client
    window.open("https://anydesk.com/en", "_blank", "noreferrer");
  };

  return (
    <section className="page5" aria-labelledby="page5-title">
      <div className="content">
        <div className="panel access-panel" role="region" aria-label="AnyDesk access panel">
          <h2 id="page5-title">Access Tool Remotely (AnyDesk)</h2>

          <p className="muted">
            Use the address and password below to connect to the remote machine with AnyDesk.
          </p>

          <ol className="guide-list" aria-label="steps to connect via AnyDesk">
            <li>Install AnyDesk on your computer: <a href="https://anydesk.com/en/downloads" target="_blank" rel="noreferrer">Download AnyDesk</a></li>
            <li>Open AnyDesk and enter the Address below (9-digit number) to connect.</li>
            <li>When prompted, enter the Password.</li>
            <li>If connection fails, check network/firewall and ensure both machines are online.</li>
          </ol>

          <figure className="guide-figure" aria-hidden="false">
            <img src={guideImg} alt="AnyDesk reference screenshot" className="guide-img" />
            <figcaption className="muted">Reference screenshot: AnyDesk UI</figcaption>
          </figure>

          <aside className="credentials" aria-label="credentials panel">
            <div className="credential-item" aria-hidden="false">
              <div className="credential-label">Address</div>
              <div className="credential-row">
                <div className="credential-value" title={DEFAULT_ADDRESS} aria-label="anydesk address">
                  {DEFAULT_ADDRESS}
                </div>
                <div className="credential-actions" role="group" aria-label="address actions">
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyToClipboard(DEFAULT_ADDRESS, "Address")}
                    aria-label="Copy address"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="credential-item" aria-hidden="false">
              <div className="credential-label">Password</div>
              <div className="credential-row">
                <div className="credential-value masked" title={DEFAULT_PASSWORD} aria-label="anydesk password">
                  {DEFAULT_PASSWORD}
                </div>
                <div className="credential-actions" role="group" aria-label="password actions">
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyToClipboard(DEFAULT_PASSWORD, "Password")}
                    aria-label="Copy password"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <div className="access-actions" role="toolbar" aria-label="quick actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={openAnyDesk}
              aria-label="Open AnyDesk website"
            >
              Open AnyDesk
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                copyToClipboard(DEFAULT_ADDRESS, "Address");
                setTimeout(openAnyDesk, 300);
              }}
              aria-label="Copy address and open AnyDesk"
            >
              Copy & Open
            </button>
          </div>

          {message && (
            <div
              className="form-success access-msg"
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default RemoteAccess;
