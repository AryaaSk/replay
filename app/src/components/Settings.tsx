import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import type { Settings as S } from "@shared/types";

interface Props {
  onClose: () => void;
}

export function SettingsPane({ onClose }: Props) {
  const [settings, setSettings] = useState<S | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyMessage, setKeyMessage] = useState<string>("");

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    void ipc.hasApiKey().then(setHasKey);
  }, []);

  if (!settings) {
    return (
      <div className="absolute inset-0 bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-500">Loading…</div>
      </div>
    );
  }

  const update = (patch: Partial<S>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void ipc.setSettings(next);
  };

  const onSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyMessage("Empty key — nothing saved");
      return;
    }
    await ipc.setApiKey(trimmed);
    setHasKey(true);
    setKeyInput("");
    setKeyMessage("Saved to Keychain");
    setTimeout(() => setKeyMessage(""), 2000);
  };

  const onDeleteKey = async () => {
    await ipc.setApiKey("");
    setHasKey(false);
    setKeyMessage("Removed from Keychain");
    setTimeout(() => setKeyMessage(""), 2000);
  };

  return (
    <div className="absolute inset-0 bg-neutral-950 flex flex-col">
      <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-900/80">
        <div className="text-sm text-neutral-300">Settings</div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-100 text-xl leading-none px-1"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-6 text-sm">
        <Section title="Anthropic API key">
          <div className="text-xs text-neutral-500 mb-2">
            Stored in macOS Keychain. Used for the Claude vision call.
          </div>
          {hasKey ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-500">● key saved</span>
              <button
                onClick={() => void onDeleteKey()}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ) : null}
          <div className="flex gap-2 mt-2">
            <input
              type="password"
              placeholder="sk-ant-api03-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="flex-1 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-xs"
            />
            <button
              onClick={() => void onSaveKey()}
              className="text-xs px-3 py-1 rounded bg-neutral-100 text-neutral-900"
            >
              Save
            </button>
          </div>
          {keyMessage ? (
            <div className="text-xs text-neutral-500 mt-1">{keyMessage}</div>
          ) : null}
        </Section>

        <Section title="Model">
          <Radio
            value={settings.model}
            options={[
              { v: "claude-sonnet-4-6", label: "claude-sonnet-4-6 (recommended)" },
              { v: "claude-haiku-4-5", label: "claude-haiku-4-5 (cheaper)" },
              { v: "claude-opus-4-7", label: "claude-opus-4-7 (best quality)" },
            ]}
            onChange={(v) => update({ model: v as S["model"] })}
          />
        </Section>

        <Section title="Capture">
          <Toggle
            checked={settings.alwaysWarm}
            onChange={(v) => update({ alwaysWarm: v })}
            label="Keep screenpipe always warm"
            help="ON: instant record + clip-after-the-fact. OFF: maximum privacy — screenpipe only runs during explicit recordings."
          />
          {settings.alwaysWarm ? (
            <div className="ml-6 mt-2">
              <div className="text-xs text-neutral-500 mb-1">Look-back buffer (always-warm only)</div>
              <Radio
                value={String(settings.lookbackSeconds)}
                options={[
                  { v: "30", label: "30s" },
                  { v: "60", label: "60s" },
                  { v: "120", label: "2 min" },
                  { v: "300", label: "5 min" },
                ]}
                onChange={(v) => update({ lookbackSeconds: Number(v) as S["lookbackSeconds"] })}
              />
            </div>
          ) : null}
          <Toggle
            checked={settings.filterMusic}
            onChange={(v) => update({ filterMusic: v })}
            label="Filter music from audio transcription"
          />
          <Toggle
            checked={settings.usePiiRemoval}
            onChange={(v) => update({ usePiiRemoval: v })}
            label="Use screenpipe's built-in PII removal"
          />
          <Toggle
            checked={settings.disableAudio}
            onChange={(v) => update({ disableAudio: v })}
            label="Disable audio capture entirely"
          />
        </Section>

        <Section title="Privacy">
          <Toggle
            checked={settings.redactSecrets}
            onChange={(v) => update({ redactSecrets: v })}
            label="Redact API keys / Bearer tokens before sending"
          />
          <Toggle
            checked={settings.confirmBeforeSend}
            onChange={(v) => update({ confirmBeforeSend: v })}
            label="Confirm before sending to Anthropic"
          />
          <Toggle
            checked={settings.wipeOnQuit}
            onChange={(v) => update({ wipeOnQuit: v })}
            label="Wipe data dir when app quits"
          />
        </Section>

        <Section title="Output">
          <Toggle
            checked={settings.autoCopyToClipboard}
            onChange={(v) => update({ autoCopyToClipboard: v })}
            label="Auto-copy markdown to clipboard"
          />
          <Toggle
            checked={settings.saveBundleToDocuments}
            onChange={(v) => update({ saveBundleToDocuments: v })}
            label="Save bundle to ~/Documents/Replay/"
          />
        </Section>

        <Section title="screenpipe">
          <div className="text-xs text-neutral-500">
            Pinned version: {settings.pinnedScreenpipeVersion ?? "latest known-good"}
          </div>
          <Toggle
            checked={settings.autoCheckScreenpipeUpdates}
            onChange={(v) => update({ autoCheckScreenpipeUpdates: v })}
            label="Auto-check for updates"
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
        />
        <div>
          <div>{label}</div>
          {help ? <div className="text-xs text-neutral-500">{help}</div> : null}
        </div>
      </label>
    </div>
  );
}

function Radio({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap">
      {options.map((o) => (
        <label key={o.v} className="flex items-center gap-1 cursor-pointer text-sm">
          <input
            type="radio"
            checked={value === o.v}
            onChange={() => onChange(o.v)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
