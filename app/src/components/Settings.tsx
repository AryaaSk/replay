import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL_FOR,
  OPENAI_MODELS,
  type AgentStatus,
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
  const [agents, setAgents] = useState<AgentStatus | null>(null);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");
  const [keyMessage, setKeyMessage] = useState<string>("");

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    void ipc.hasApiKey("anthropic").then(setHasAnthropic);
    void ipc.hasApiKey("openai").then(setHasOpenAI);
    void ipc.agentStatus().then(setAgents);
  }, []);

  if (!settings) {
    return (
      <div className="absolute inset-0 bg-ink flex items-center justify-center">
        <div className="text-2xs uppercase tracking-widest text-dust animate-tick">
          loading
        </div>
      </div>
    );
  }

  const update = (patch: Partial<S>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void ipc.setSettings(next);
  };

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
      setKeyMessage("empty key — nothing saved");
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
    setKeyMessage(`${provider} key saved to keychain`);
    setTimeout(() => setKeyMessage(""), 2000);
  };

  const onDeleteKey = async (provider: Provider) => {
    await ipc.setApiKey(provider, "");
    if (provider === "anthropic") setHasAnthropic(false);
    else setHasOpenAI(false);
    setKeyMessage(`${provider} key removed`);
    setTimeout(() => setKeyMessage(""), 2000);
  };

  const isLocalAgent = settings.provider === "local-claude" || settings.provider === "local-codex";
  const modelOptions =
    settings.provider === "anthropic"
      ? ANTHROPIC_MODELS
      : settings.provider === "openai"
      ? OPENAI_MODELS
      : [];

  const providerOptions: Array<{ v: Provider; label: string; status: "available" | "missing" | "key-needed"; sub: string }> = [
    {
      v: "local-claude",
      label: "local · claude code",
      status: agents?.claude.installed ? "available" : "missing",
      sub: agents?.claude.installed
        ? `via ${agents.claude.path ?? "claude"} · uses your CLI auth`
        : "claude not found in PATH",
    },
    {
      v: "local-codex",
      label: "local · codex cli",
      status: agents?.codex.installed ? "available" : "missing",
      sub: agents?.codex.installed
        ? `via ${agents.codex.path ?? "codex"} · uses your CLI auth`
        : "codex not found in PATH",
    },
    {
      v: "anthropic",
      label: "api · anthropic claude",
      status: hasAnthropic ? "available" : "key-needed",
      sub: hasAnthropic ? "byok · key in keychain" : "byok · paste a key below",
    },
    {
      v: "openai",
      label: "api · openai gpt",
      status: hasOpenAI ? "available" : "key-needed",
      sub: hasOpenAI ? "byok · key in keychain" : "byok · paste a key below",
    },
  ];

  return (
    <div className="absolute inset-0 bg-ink flex flex-col animate-fade-in">
      <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-rule bg-carbon/40 select-none">
        <div className="flex items-baseline gap-3">
          <span className="text-2xs uppercase tracking-[0.3em] text-dust">configure</span>
          <span className="text-sm text-bone">settings</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="text-ash hover:text-bone text-2xl leading-none px-2"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5 space-y-7">
        <Section index="01" title="Provider">
          <div className="flex flex-col gap-1.5">
            {providerOptions.map((opt) => (
              <ProviderRow
                key={opt.v}
                option={opt}
                active={settings.provider === opt.v}
                onClick={() => onProviderChange(opt.v)}
              />
            ))}
          </div>
        </Section>

        {!isLocalAgent ? (
          <Section index="02" title="Model">
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
        ) : (
          <Section index="02" title="Model">
            <div className="text-2xs uppercase tracking-widest text-dust">
              uses your cli's configured model · no replay override
            </div>
          </Section>
        )}

        <Section index="03" title="API keys">
          <div className="text-2xs text-dust uppercase tracking-widest">
            byok api providers only · stored in macos keychain · local agents use their own auth
          </div>
          <div className="space-y-3 mt-3">
            <KeyInput
              label="anthropic"
              placeholder="sk-ant-api03-…"
              saved={hasAnthropic}
              value={anthropicInput}
              onChange={setAnthropicInput}
              onSave={() => void onSaveKey("anthropic", anthropicInput)}
              onDelete={() => void onDeleteKey("anthropic")}
            />
            <KeyInput
              label="openai"
              placeholder="sk-proj-…"
              saved={hasOpenAI}
              value={openaiInput}
              onChange={setOpenaiInput}
              onSave={() => void onSaveKey("openai", openaiInput)}
              onDelete={() => void onDeleteKey("openai")}
            />
          </div>
          {keyMessage ? (
            <div className="text-2xs uppercase tracking-widest text-moss mt-2">
              ● {keyMessage}
            </div>
          ) : null}
        </Section>

        <Section index="04" title="Capture">
          <Toggle
            checked={settings.alwaysWarm}
            onChange={(v) => update({ alwaysWarm: v })}
            label="keep screenpipe always warm"
            help="ON: instant record + clip-after-the-fact. OFF: screenpipe only runs during explicit recordings."
          />
          {settings.alwaysWarm ? (
            <div className="ml-5 mt-3 pl-4 border-l border-rule">
              <div className="text-2xs uppercase tracking-widest text-dust mb-2">
                look-back buffer
              </div>
              <Radio
                value={String(settings.lookbackSeconds)}
                options={[
                  { v: "30", label: "30s" },
                  { v: "60", label: "60s" },
                  { v: "120", label: "2m" },
                  { v: "300", label: "5m" },
                ]}
                onChange={(v) => update({ lookbackSeconds: Number(v) as S["lookbackSeconds"] })}
              />
            </div>
          ) : null}
          <Toggle
            checked={settings.filterMusic}
            onChange={(v) => update({ filterMusic: v })}
            label="filter music from audio transcription"
          />
          <Toggle
            checked={settings.usePiiRemoval}
            onChange={(v) => update({ usePiiRemoval: v })}
            label="use screenpipe's built-in pii removal"
          />
          <Toggle
            checked={settings.disableAudio}
            onChange={(v) => update({ disableAudio: v })}
            label="disable audio capture entirely"
          />
        </Section>

        <Section index="05" title="Privacy">
          <Toggle
            checked={settings.redactSecrets}
            onChange={(v) => update({ redactSecrets: v })}
            label="redact api keys / bearer tokens before sending"
          />
          <Toggle
            checked={settings.confirmBeforeSend}
            onChange={(v) => update({ confirmBeforeSend: v })}
            label="confirm before sending to provider"
          />
          <Toggle
            checked={settings.wipeOnQuit}
            onChange={(v) => update({ wipeOnQuit: v })}
            label="wipe data dir when app quits"
          />
        </Section>

        <Section index="06" title="Output">
          <Toggle
            checked={settings.autoCopyToClipboard}
            onChange={(v) => update({ autoCopyToClipboard: v })}
            label="auto-copy markdown to clipboard"
          />
          <Toggle
            checked={settings.saveBundleToDocuments}
            onChange={(v) => update({ saveBundleToDocuments: v })}
            label="save bundle to ~/Documents/Replay/"
          />
        </Section>

        <Section index="07" title="screenpipe">
          <div className="text-2xs uppercase tracking-widest text-dust">
            pinned · {settings.pinnedScreenpipeVersion ?? "latest known-good"}
          </div>
          <Toggle
            checked={settings.autoCheckScreenpipeUpdates}
            onChange={(v) => update({ autoCheckScreenpipeUpdates: v })}
            label="auto-check for updates"
          />
        </Section>
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="section-label">
        <span className="num">{index}</span>
        <span className="flex-1 border-b border-rule h-2" />
        <span className="text-bone tracking-[0.2em]">{title}</span>
      </div>
      <div className="space-y-2.5 pl-7">{children}</div>
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
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 text-left group"
    >
      <span
        className={[
          "mt-0.5 inline-flex items-center justify-center w-4 h-4 border transition-colors shrink-0",
          checked ? "bg-bone border-bone" : "bg-ink border-grit group-hover:border-ash",
        ].join(" ")}
      >
        {checked ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-5" stroke="#16140F" strokeWidth="1.6" strokeLinecap="square" />
          </svg>
        ) : null}
      </span>
      <div className="flex-1">
        <div className="text-xs text-bone">{label}</div>
        {help ? <div className="text-2xs text-dust mt-0.5 leading-relaxed">{help}</div> : null}
      </div>
    </button>
  );
}

function ProviderRow({
  option,
  active,
  onClick,
}: {
  option: { v: Provider; label: string; status: "available" | "missing" | "key-needed"; sub: string };
  active: boolean;
  onClick: () => void;
}) {
  const statusColor =
    option.status === "available"
      ? "text-moss"
      : option.status === "key-needed"
      ? "text-ash"
      : "text-ember";
  const statusGlyph = option.status === "available" ? "●" : option.status === "key-needed" ? "○" : "▲";
  return (
    <button
      onClick={onClick}
      className={[
        "w-full flex items-start gap-3 px-3 py-2 text-left border transition-colors",
        active
          ? "border-bone bg-carbon"
          : "border-rule hover:border-grit hover:bg-carbon/50",
      ].join(" ")}
    >
      <span className={`${statusColor} text-xs leading-5 shrink-0 w-3`}>{statusGlyph}</span>
      <span className="flex-1 min-w-0">
        <span className={["block text-xs", active ? "text-bone" : "text-bone"].join(" ")}>{option.label}</span>
        <span className="block text-2xs uppercase tracking-widest text-dust truncate mt-0.5">
          {option.sub}
        </span>
      </span>
    </button>
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
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={[
            "px-3 py-1 text-xs border transition-colors",
            value === o.v
              ? "border-bone bg-bone text-ink"
              : "border-rule text-ash hover:border-ash hover:text-bone",
          ].join(" ")}
        >
          {o.label}
        </button>
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
    <div className="field">
      <div className="flex items-center justify-between">
        <div className="field-label">{label}</div>
        {saved ? (
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-widest text-moss">● saved</span>
            <button onClick={onDelete} className="text-2xs uppercase tracking-widest text-dust hover:text-ember">
              remove
            </button>
          </div>
        ) : (
          <span className="text-2xs uppercase tracking-widest text-dust">not set</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field-input flex-1 font-mono"
          spellCheck={false}
        />
        <button onClick={onSave} className="btn-primary">save</button>
      </div>
    </div>
  );
}
