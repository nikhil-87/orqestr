"use client";

import { useState } from "react";
import { X, Info, Trash2, Play, Loader2, CheckCircle2, AlertTriangle, Settings2, FlaskConical } from "lucide-react";
import { Node } from "@xyflow/react";
import { AgentNodeData, LLMConfig, HTTPConfig, TransformConfig } from "@/lib/types";
import { useTestAgent, type TestAgentResponse } from "@/hooks/use-agent";
import { toast } from "sonner";

type NodeConfigPanelProps = {
  node: Node<AgentNodeData>;
  onClose: () => void;
  onSave: (nodeId: string, config: AgentNodeData) => void;
  onDelete?: (nodeId: string) => void;
};

const NodeConfigPanel = ({ node, onClose, onSave, onDelete }: NodeConfigPanelProps) => {
  const type = node.data.type;
  const [activeTab, setActiveTab] = useState<"params" | "test">("params");
  const { mutateAsync: testAgentMutation, isPending: isTesting } = useTestAgent();

  // Test state
  const [testInput, setTestInput] = useState("{\n  \"message\": \"Sample test query\"\n}");
  const [testResult, setTestResult] = useState<TestAgentResponse | null>(null);

  // LLM state
  const [promptTemplate, setPromptTemplate] = useState(
    (node.data.config as LLMConfig)?.promptTemplate ?? "",
  );

  const [model, setModel] = useState(
    (node.data.config as LLMConfig)?.model ?? "openai/gpt-oss-120b",
  );

  const [maxTokens, setMaxTokens] = useState(
    (node.data.config as LLMConfig)?.maxTokens ?? 1000,
  );

  const [temperature, setTemperature] = useState(
    (node.data.config as LLMConfig)?.temperature ?? 0.7,
  );

  // HTTP state
  const [url, setUrl] = useState((node.data.config as HTTPConfig)?.url ?? "");

  const [method, setMethod] = useState<HTTPConfig["method"]>(
    (node.data.config as HTTPConfig)?.method ?? "GET",
  );

  const [headers, setHeaders] = useState(
    JSON.stringify((node.data.config as HTTPConfig)?.headers ?? {}, null, 2),
  );

  const [body, setBody] = useState(
    JSON.stringify((node.data.config as HTTPConfig)?.body ?? {}, null, 2),
  );

  // Transform state
  const [description, setDescription] = useState(
    (node.data.config as TransformConfig)?.description ?? "",
  );

  // Guide state
  const [showLlmGuide, setShowLlmGuide] = useState(false);
  const [showTransformGuide, setShowTransformGuide] = useState(false);

  // Shared state
  const [label, setLabel] = useState(node.data.label);
  const [critical, setCritical] = useState(node.data.critical ?? true);

  const getComputedConfig = () => {
    if (type === "LLM_AGENT") {
      return {
        promptTemplate,
        model,
        maxTokens,
        temperature,
      };
    } else if (type === "HTTP_AGENT") {
      return {
        url,
        method,
        headers: headers.trim() ? JSON.parse(headers) : {},
        body:
          method === "POST" || method === "PUT"
            ? body.trim()
              ? JSON.parse(body)
              : {}
            : undefined,
      };
    } else {
      return { description };
    }
  };

  const handleTestStep = async () => {
    try {
      let parsedInput = {};
      if (testInput.trim()) {
        try {
          parsedInput = JSON.parse(testInput);
        } catch {
          toast.error("Test input must be valid JSON");
          return;
        }
      }

      let config: ReturnType<typeof getComputedConfig>;
      try {
        config = getComputedConfig();
      } catch {
        toast.error("Invalid JSON in headers or body");
        return;
      }

      const res = await testAgentMutation({
        type,
        config: config as Record<string, unknown>,
        input: parsedInput,
      });

      const data = res?.data?.data ?? res?.data ?? res;
      setTestResult(data as TestAgentResponse);
      if ((data as TestAgentResponse)?.success) {
        toast.success(`Agent executed in ${(data as TestAgentResponse).durationMs}ms`);
      } else {
        toast.error((data as TestAgentResponse)?.error || "Agent execution failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Test execution failed";
      toast.error(msg);
    }
  };

  const handleSave = () => {
    let config: AgentNodeData["config"];
    try {
      config = getComputedConfig();
    } catch {
      toast.error("Invalid JSON in headers or body");
      return;
    }

    onSave(node.id, {
      ...node.data,
      label,
      config,
      critical,
    });
  };

  return (
    <aside className="fixed right-0 top-16 z-40 h-[calc(100vh-4rem)] w-[360px] border-l border-border bg-sidebar/95 p-6 backdrop-blur-xl sm:w-[400px]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Configure Node</h2>
          <p className="mt-1 text-xs text-muted-foreground">{node.data.label}</p>
        </div>

        <button
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("params")}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeTab === "params"
              ? "bg-card-foreground text-background shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>Parameters</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("test")}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeTab === "test"
              ? "bg-card-foreground text-background shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          <span>Test Step</span>
        </button>
      </div>

      {/* Fields Tab */}
      {activeTab === "params" ? (
        <div className="mt-4 flex max-h-[calc(100vh-21rem)] flex-col gap-4 overflow-y-auto pr-1">
        {/* Node Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Node Name</label>

          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition-colors focus:border-white/20"
            placeholder="Enter a name for this node..."
          />
        </div>

        {/* LLM */}
        {type === "LLM_AGENT" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Prompt Template</label>
                <button
                  type="button"
                  onClick={() => setShowLlmGuide((prev) => !prev)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Info className="h-3.5 w-3.5 text-zinc-400" />
                  <span>{showLlmGuide ? "Hide Guide" : "Variables Guide"}</span>
                </button>
              </div>

              {showLlmGuide && (
                <div className="w-full rounded-xl border border-white/10 bg-zinc-950/90 p-3 text-xs text-white shadow-lg backdrop-blur-md animate-in fade-in-50 duration-200">
                  <p className="font-semibold text-white">How variables work</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Inject output from upstream nodes using <code className="rounded bg-white/10 px-1 py-0.5 text-white">{"{{...}}"}</code>:
                  </p>
                  <div className="mt-2 space-y-1.5 text-[11px]">
                    <div className="rounded-lg border border-white/5 bg-white/5 p-1.5">
                      <code className="text-emerald-400">{"{{input}}"}</code>
                      <p className="text-[10px] text-zinc-400">Entire upstream node output (JSON or string)</p>
                    </div>
                    <div className="rounded-lg border border-white/5 bg-white/5 p-1.5">
                      <code className="text-sky-400">{"{{body}}"}</code> or <code className="text-sky-400">{"{{topic}}"}</code>
                      <p className="text-[10px] text-zinc-400">Direct property or wrapper field</p>
                    </div>
                    <div className="rounded-lg border border-white/5 bg-white/5 p-1.5">
                      <code className="text-amber-400">{"{{user.username}}"}</code>
                      <p className="text-[10px] text-zinc-400">Nested dot-notation property</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] italic text-zinc-500">
                    Tip: Check the Run Monitor to see exact keys from previous nodes.
                  </p>
                </div>
              )}

              <textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                className="min-h-35 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition-colors focus:border-white/20"
                placeholder="Write your prompt using {{variable}} placeholders..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Model</label>

              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-white/20 cursor-pointer"
              >
                <option value="openai/gpt-oss-120b" className="bg-zinc-900 text-foreground py-1">openai/gpt-oss-120b (Recommended)</option>
                <option value="openai/gpt-oss-20b" className="bg-zinc-900 text-foreground py-1">openai/gpt-oss-20b (Fast)</option>
                <option value="qwen/qwen3.6-27b" className="bg-zinc-900 text-foreground py-1">qwen/qwen3.6-27b (Reasoning)</option>
                <option value="allam-2-7b" className="bg-zinc-900 text-foreground py-1">allam-2-7b</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Tokens</label>

                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
                  placeholder="1000"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Temperature</label>

                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
                  placeholder="0.7"
                />
              </div>
            </div>
          </>
        )}

        {/* HTTP */}
        {type === "HTTP_AGENT" && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">URL</label>

              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
                placeholder="https://api.example.com/users/{{userId}}"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Method</label>

              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as HTTPConfig["method"])}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-white/20 cursor-pointer"
              >
                <option value="GET" className="bg-zinc-900 text-foreground py-1">GET</option>
                <option value="POST" className="bg-zinc-900 text-foreground py-1">POST</option>
                <option value="PUT" className="bg-zinc-900 text-foreground py-1">PUT</option>
                <option value="DELETE" className="bg-zinc-900 text-foreground py-1">DELETE</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Headers (JSON)</label>

              <textarea
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                className="min-h-28 w-full rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm outline-none"
                placeholder={`{\n  "Authorization": "Bearer {{token}}"\n}`}
              />
            </div>

            {(method === "POST" || method === "PUT") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Body (JSON)</label>

                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-40 w-full rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm outline-none"
                  placeholder={`{\n  "email": "{{email}}",\n  "name": "{{name}}"\n}`}
                />
              </div>
            )}
          </>
        )}

        {/* TRANSFORM */}
        {type === "TRANSFORM_AGENT" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Transformation Description</label>
              <button
                type="button"
                onClick={() => setShowTransformGuide((prev) => !prev)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
              >
                <Info className="h-3.5 w-3.5 text-zinc-400" />
                <span>{showTransformGuide ? "Hide Guide" : "Guide"}</span>
              </button>
            </div>

            {showTransformGuide && (
              <div className="w-full rounded-xl border border-white/10 bg-zinc-950/90 p-3 text-xs text-white shadow-lg backdrop-blur-md animate-in fade-in-50 duration-200">
                <p className="font-semibold text-white">How transformation works</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                  Describe in plain English what JSON schema to extract or convert from the previous node output.
                </p>
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <div className="rounded-lg border border-white/5 bg-white/5 p-1.5">
                    <p className="text-[10px] font-medium text-emerald-400">Example Description:</p>
                    <p className="text-[10px] italic text-zinc-300">
                      &quot;Extract sentiment, urgencyLevel, and actionPlan into clean JSON.&quot;
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[10px] italic text-zinc-500">
                  The Transform Agent always returns raw structured JSON.
                </p>
              </div>
            )}

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-40 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition-colors focus:border-white/20"
              placeholder="Describe the transformation logic (e.g. Extract fullName and city into a JSON object)..."
            />
          </div>
        )}

        {/* Critical toggle */}
        <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
          />

          <div>
            <p className="text-sm font-medium">Critical Node</p>

            <p className="text-xs text-muted-foreground">
              Fail entire workflow if this node fails
            </p>
          </div>
        </label>
      </div>
      ) : (
        /* Test Step Tab */
        <div className="mt-4 flex max-h-[calc(100vh-21rem)] flex-col gap-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Mock Input JSON
              </label>
              <span className="text-[11px] text-muted-foreground">Simulates previous node output</span>
            </div>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs text-foreground outline-none transition-colors focus:border-white/20"
              placeholder={`{\n  "input": "Sample test data"\n}`}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleTestStep}
              disabled={isTesting}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-card-foreground px-4 py-2 text-xs font-semibold text-background transition-all hover:bg-white disabled:opacity-50"
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>{isTesting ? "Executing..." : "Run Test Step"}</span>
            </button>
          </div>

          {/* Test Result Inspector */}
          {testResult && (
            <div className="mt-2 space-y-2 rounded-xl border border-border bg-card/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                  )}
                  <span
                    className={`text-xs font-semibold ${
                      testResult.success ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {testResult.success ? "Execution Succeeded" : "Execution Failed"}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {testResult.durationMs}ms
                </span>
              </div>

              {testResult.success ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Output Response
                  </label>
                  <pre className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-2.5 font-mono text-xs leading-relaxed text-zinc-300">
                    {typeof testResult.output === "object"
                      ? JSON.stringify(testResult.output, null, 2)
                      : String(testResult.output)}
                  </pre>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                    Error Details
                  </label>
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 font-mono text-xs text-red-300">
                    {testResult.error}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-2">
        <button
          onClick={handleSave}
          className="w-full cursor-pointer rounded-xl border border-border bg-card-foreground px-4 py-3 text-sm font-medium text-background transition-all duration-300 hover:scale-[1.02] hover:bg-white"
        >
          Save Configuration
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-all duration-200 hover:bg-red-500/20 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Node</span>
          </button>
        )}
      </div>
    </aside>
  );
};

export default NodeConfigPanel;
