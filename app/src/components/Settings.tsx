import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL_FOR,
  OPENAI_MODELS,
  type AgentStatus,
  type AnthropicModel,
  type MonitorInfo,
  type OpenAIModel,
  type PermissionKind,
  type PermissionsReport,
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
  const [permissions, setPermissions] = useState<PermissionsReport | null>(null);
  const [permissionsRechecking, setPermissionsRechecking] = useState(false);
  const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
  const [monitorsError, setMonitorsError] = useState<string | null>(null);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");
  const [keyMessage, setKeyMessage] = useState<string>("");

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    void ipc.hasApiKey("anthropic").then(setHasAnthropic);
    void ipc.hasApiKey("openai").then(setHasOpenAI);
    void ipc.agentStatus().then(setAgents);
    void ipc.checkPermissions().then(setPermissions);
    void ipc.listMonitors()
      .then((m) => {
        setMonitors(m);
        setMonitorsError(null);
      })
      .catch((e) => setMonitorsError(String(e)));
  }, []);

  const recheckPermissions = async () => {
    setPermissionsRechecking(true);
    try {
      const r = await ipc.checkPermissions();
      setPermissions(r);
    } finally {
      setPermissionsRechecking(false);
    }
  };

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
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    // Await the Rust roundtrip so failures aren't swallowed. If save fails
    // the disk and Rust state stay consistent (Rust state isn't mutated
    // until after disk write succeeds), and we re-fetch to bring React
    // back into sync rather than letting it lie.
    ipc.setSettings(next).catch(async (e: unknown) => {
      setKeyMessage(`save failed: ${String(e)}`);
      const fresh = await ipc.getSettings();
      setSettings(fresh);
    });
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

  const providerOptions: Array<{ v: Provider; label: string; status: "available" | "missing" | "key-needed"; sub: string; note?: string }> = [
    {
      v: "local-claude",
      label: "local · claude code",
      status: agents?.claude.installed ? "available" : "missing",
      sub: agents?.claude.installed
        ? `via ${agents.claude.path ?? "claude"} · uses your CLI auth`
        : "claude not found in PATH",
      note: "session transcripts persist at ~/.claude/projects/. cleared when you delete a replay.",
    },
    {
      v: "local-codex",
      label: "local · codex cli",
      status: agents?.codex.installed ? "available" : "missing",
      sub: agents?.codex.installed
        ? `via ${agents.codex.path ?? "codex"} · uses your CLI auth`
        : "codex not found in PATH",
      note: "session transcripts persist in ~/.codex/. cleared when you delete a replay.",
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

          <div className="mt-4">
            <div className="text-2xs uppercase tracking-widest text-dust mb-2">
              displays to capture
            </div>
            {monitorsError ? (
              <div className="text-2xs uppercase tracking-widest text-ember">
                ▲ {monitorsError}
              </div>
            ) : monitors === null ? (
              <div className="text-2xs uppercase tracking-widest text-dust animate-tick">
                ▮ probing displays
              </div>
            ) : (
              <MonitorPicker
                monitors={monitors}
                selected={settings.monitorIds}
                onChange={(ids) => update({ monitorIds: ids })}
              />
            )}
          </div>
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

        <Section index="07" title="Permissions">
          <div className="text-2xs uppercase tracking-widest text-dust mb-2">
            macos grants these to the screenpipe binary, not to replay. open the relevant pane, toggle screenpipe on, then re-check.
          </div>
          <PermissionRow
            label="screen recording"
            kind="screen-recording"
            status={permissions?.screenRecording}
            required
          />
          <PermissionRow
            label="microphone"
            kind="microphone"
            status={permissions?.microphone}
            required={!settings.disableAudio}
            note={settings.disableAudio ? "not required (audio capture disabled)" : undefined}
          />
          <PermissionRow
            label="accessibility"
            kind="accessibility"
            status={permissions?.accessibility}
            required
          />
          <button
            onClick={() => void recheckPermissions()}
            disabled={permissionsRechecking}
            className="btn-secondary mt-2 w-full disabled:opacity-50"
          >
            {permissionsRechecking ? "▮ probing screenpipe…" : "↻ re-check permissions"}
          </button>
        </Section>

        <Section index="07b" title="screenpipe">
          <div className="text-2xs uppercase tracking-widest text-dust">
            pinned · {settings.pinnedScreenpipeVersion ?? "latest known-good"}
          </div>
          <Toggle
            checked={settings.autoCheckScreenpipeUpdates}
            onChange={(v) => update({ autoCheckScreenpipeUpdates: v })}
            label="auto-check for updates"
          />
        </Section>

        <Section index="08" title="Storage">
          <div className="text-2xs uppercase tracking-widest text-dust mb-3">
            everywhere replay touches your disk
          </div>
          <pre className="text-2xs leading-relaxed text-ash bg-carbon/40 border border-rule p-3 overflow-x-auto whitespace-pre">
{`~/Library/Application Support/Replay/
├── bin/
│   ├── screenpipe              managed binary
│   └── mlx.metallib            metal compute lib (sibling)
├── .screenpipe/                screenpipe's data dir
│   ├── db.sqlite               captured events
│   ├── data/<date>/*.jpg       frame snapshots
│   ├── *.mp4                   audio chunks
│   └── screenpipe.*.log        capture log
├── replays/<ulid>/             one folder per replay
│   ├── report.md               agent / api output
│   ├── metadata.json           timestamps, model, cost
│   ├── frames/*.png            key frames
│   ├── events.json             coalesced timeline
│   ├── audio.txt               speech transcript
│   └── context.md              recording metadata
├── settings.json               your prefs
└── logs/sidecar-*.log          post-mortem logs

macOS Keychain — service: app.replay
├── anthropic-api-key           BYOK (only if anthropic provider)
└── openai-api-key              BYOK (only if openai provider)`}
          </pre>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <FolderButton
              label="open Replay folder"
              sub="all of the above"
              onClick={() => void ipc.openAppFolder("root")}
            />
            <FolderButton
              label="open replays/"
              sub="saved replay bundles"
              onClick={() => void ipc.openAppFolder("replays")}
            />
            <FolderButton
              label="open screenpipe data"
              sub="raw capture + db.sqlite"
              onClick={() => void ipc.openAppFolder("screenpipe")}
            />
            <FolderButton
              label="open logs/"
              sub="sidecar post-mortems"
              onClick={() => void ipc.openAppFolder("logs")}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-rule space-y-2">
            <div className="text-2xs uppercase tracking-widest text-dust">
              danger zone
            </div>
            <button
              onClick={async () => {
                if (!confirm("delete all replay bundles? individual reports + frames go away. screenpipe data + settings stay.")) return;
                const n = await ipc.deleteAllReplays();
                setKeyMessage(`deleted ${n} replay${n === 1 ? "" : "s"}`);
                setTimeout(() => setKeyMessage(""), 2500);
              }}
              className="btn-danger w-full justify-start"
            >
              ▲ delete all replays
            </button>
            <button
              onClick={async () => {
                if (!confirm("wipe ALL replay state? deletes replays + screenpipe captures + sidecar logs + claude session transcripts. settings + api keys stay. cannot undo.")) return;
                await ipc.wipeAllState();
                setKeyMessage("wiped: fresh state");
                setTimeout(() => setKeyMessage(""), 2500);
              }}
              className="btn-danger w-full justify-start"
            >
              ▲▲ wipe everything (nuclear)
            </button>
          </div>
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
  option: { v: Provider; label: string; status: "available" | "missing" | "key-needed"; sub: string; note?: string };
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
        <span className="block text-xs text-bone">{option.label}</span>
        <span className="block text-2xs uppercase tracking-widest text-dust truncate mt-0.5">
          {option.sub}
        </span>
        {active && option.note ? (
          <span className="block text-2xs text-dust normal-case tracking-normal mt-1.5 leading-relaxed">
            ⓘ {option.note}
          </span>
        ) : null}
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

function MonitorPicker({
  monitors,
  selected,
  onChange,
}: {
  monitors: MonitorInfo[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const allSelected = selected.length === 0;
  const toggle = (id: number) => {
    // Build the next selection treating "all" as the empty array. Selecting an
    // explicit id while currently in "all" means: only that one. Toggling the
    // last specific id off goes back to "all".
    if (allSelected) {
      onChange([id]);
      return;
    }
    if (selected.includes(id)) {
      const next = selected.filter((x) => x !== id);
      onChange(next);
    } else {
      onChange([...selected, id].sort((a, b) => a - b));
    }
  };
  return (
    <div className="space-y-1.5">
      <button
        onClick={() => onChange([])}
        className={[
          "w-full flex items-baseline justify-between gap-3 px-3 py-2 border text-left transition-colors",
          allSelected
            ? "border-bone bg-bone/5"
            : "border-rule hover:border-ash",
        ].join(" ")}
      >
        <span className={["text-xs", allSelected ? "text-bone" : "text-ash"].join(" ")}>
          all displays
        </span>
        <span className="text-2xs uppercase tracking-widest text-dust">
          {monitors.length} detected
        </span>
      </button>
      {monitors.map((m) => {
        const isOn = !allSelected && selected.includes(m.id);
        return (
          <button
            key={m.id}
            onClick={() => toggle(m.id)}
            className={[
              "w-full flex items-baseline justify-between gap-3 px-3 py-2 border text-left transition-colors",
              isOn ? "border-bone bg-bone/5" : "border-rule hover:border-ash",
            ].join(" ")}
          >
            <span className="flex items-baseline gap-2 min-w-0">
              <span
                className={[
                  "font-mono text-2xs tabular-nums w-6 shrink-0",
                  isOn ? "text-bone" : "text-dust",
                ].join(" ")}
              >
                {String(m.id).padStart(2, "0")}
              </span>
              <span className={["text-xs truncate", isOn ? "text-bone" : "text-ash"].join(" ")}>
                {m.name}
              </span>
              {m.isDefault ? (
                <span className="text-2xs uppercase tracking-widest text-moss">·primary</span>
              ) : null}
            </span>
            <span className="font-mono text-2xs tabular-nums text-dust shrink-0">
              {m.width}×{m.height}
            </span>
          </button>
        );
      })}
      <div className="text-2xs uppercase tracking-widest text-dust pt-1">
        {allSelected
          ? "screenpipe captures every connected display"
          : `capturing ${selected.length} of ${monitors.length}`}
      </div>
    </div>
  );
}

function PermissionRow({
  label,
  kind,
  status,
  required,
  note,
}: {
  label: string;
  kind: PermissionKind;
  status: "ok" | "denied" | "unknown" | undefined;
  required: boolean;
  note?: string;
}) {
  const glyph =
    status === "ok" ? "●" : status === "denied" ? "▲" : "○";
  const color =
    status === "ok"
      ? "text-moss"
      : status === "denied"
      ? "text-ember"
      : "text-dust";
  const stateText =
    status === "ok"
      ? "granted"
      : status === "denied"
      ? "missing"
      : "unknown";
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-rule/60 last:border-0">
      <span className={`${color} text-xs leading-5 shrink-0 w-3`}>{glyph}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-bone">{label}</span>
          {!required ? (
            <span className="text-2xs uppercase tracking-widest text-dust">optional</span>
          ) : null}
        </div>
        <div className="text-2xs uppercase tracking-widest text-dust">
          {note ?? stateText}
        </div>
      </div>
      {required ? (
        <button
          onClick={() => void ipc.openPermissionSettings(kind)}
          className="btn-secondary text-2xs"
        >
          open settings
        </button>
      ) : null}
    </div>
  );
}

function FolderButton({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start text-left px-3 py-2 border border-rule hover:border-bone hover:bg-carbon transition-colors"
    >
      <span className="text-xs text-bone">↗ {label}</span>
      <span className="text-2xs uppercase tracking-widest text-dust mt-0.5">{sub}</span>
    </button>
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
