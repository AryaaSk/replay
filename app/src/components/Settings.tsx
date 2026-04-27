import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL_FOR,
  OPENAI_MODELS,
  type AnthropicModel,
  type OpenAIModel,
  type Provider,
  type Settings as S,
} from "@shared/types";

interface Props {
  onClose: () => void;
}

export function SettingsPane({ onClose }: Props) {
  const [settings, setSettings] = useState<S | null>(null);
  const [hasAnthropic, setHasAnthropic] = useState(false);
  const [hasOpenAI, setHasOpenAI] = useState(false);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");
  const [keyMessage, setKeyMessage] = useState<string>("");

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    void ipc.hasApiKey("anthropic").then(setHasAnthropic);
    void ipc.hasApiKey("openai").then(setHasOpenAI);
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

  // When the provider switches, fall back to that provider's recommended model
  // if the previously-selected model isn't valid for the new provider.
  const onProviderChange = (next: Provider) => {
    const validIds: string[] =
      next === "anthropic"
        ? ANTHROPIC_MODELS.map((m) => m.id)
        : OPENAI_MODELS.map((m) => m.id);
    const newModel = validIds.includes(settings.model)
      ? settings.model
      : DEFAULT_MODEL_FOR[next];
    update({ provider: next, model: newModel });
  };

  const onSaveKey = async (provider: Provider, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setKeyMessage("Empty key — nothing saved");
      return;
    }
    await ipc.setApiKey(provider, trimmed);
    if (provider === "anthropic") {
      setHasAnthropic(true);
      setAnthropicInput("");
    } else {
      setHasOpenAI(true);
      setOpenaiInput("");
    }
    setKeyMessage(`Saved ${provider} key to Keychain`);
    setTimeout(() => setKeyMessage(""), 2000);
  };

  const onDeleteKey = async (provider: Provider) => {
    await ipc.setApiKey(provider, "");
    if (provider === "anthropic") setHasAnthropic(false);
    else setHasOpenAI(false);
    setKeyMessage(`Removed ${provider} key from Keychain`);
    setTimeout(() => setKeyMessage(""), 2000);
  };

  const modelOptions =
    settings.provider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;

  return (
    <div className="absolute inset-0 bg-neutral-950 flex flex-col">
      <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-900/80">
        <div className="text-sm text-neutral-300">Settings</div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-100 text-2xl leading-none px-1"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-6 text-sm">
        <Section title="Provider">
          <Radio
            value={settings.provider}
            options={[
              { v: "anthropic", label: "Anthropic Claude" },
              { v: "openai", label: "OpenAI GPT" },
            ]}
            onChange={(v) => onProviderChange(v as Provider)}
          />
        </Section>

        <Section title="Model">
          <Radio
            value={settings.model}
            options={modelOptions.map((m) => ({ v: m.id, label: m.label }))}
            onChange={(v) =>
              update({
                model:
                  settings.provider === "anthropic"
                    ? (v as AnthropicModel)
                    : (v as OpenAIModel),
              })
            }
          />
        </Section>

        <Section title="API keys">
          <div className="text-xs text-neutral-500 mb-2">
            Stored in macOS Keychain. The active provider's key is used for the next replay.
          </div>

          <KeyInput
            label="Anthropic"
            placeholder="sk-ant-api03-…"
            saved={hasAnthropic}
            value={anthropicInput}
            onChange={setAnthropicInput}
            onSave={() => void onSaveKey("anthropic", anthropicInput)}
            onDelete={() => void onDeleteKey("anthropic")}
          />
          <KeyInput
            label="OpenAI"
            placeholder="sk-proj-…"
            saved={hasOpenAI}
            value={openaiInput}
            onChange={setOpenaiInput}
            onSave={() => void onSaveKey("openai", openaiInput)}
            onDelete={() => void onDeleteKey("openai")}
          />
          {keyMessage ? (
            <div className="text-xs text-neutral-500 mt-1">{keyMessage}</div>
          ) : null}
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
            label="Confirm before sending to the AI provider"
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

function KeyInput({
  label,
  placeholder,
  saved,
  value,
  onChange,
  onSave,
  onDelete,
}: {
  label: string;
  placeholder: string;
  saved: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs text-neutral-400">{label}</div>
        {saved ? (
          <>
            <span className="text-xs text-green-500">● saved</span>
            <button
              onClick={onDelete}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-xs"
        />
        <button
          onClick={onSave}
          className="text-xs px-3 py-1 rounded bg-neutral-100 text-neutral-900"
        >
          Save
        </button>
      </div>
    </div>
  );
}
