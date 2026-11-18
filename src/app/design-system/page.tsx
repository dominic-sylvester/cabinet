"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ChevronRight, Clock3, FileText, Folder, Loader2, MessageCircleQuestion, Moon, PanelRight, Plus, Sun, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { StatusBadge } from "@/components/ui/status-badge";
import { ContentSheet } from "@/components/layout/content-sheet";
import { FolderTabs } from "@/components/layout/folder-tabs";
import { ToolbarButton } from "@/components/layout/toolbar-button";
import { useTheme } from "@/components/theme-provider";
import { applyTheme, DEFAULT_THEME_PAIR, findThemeByName, THEMES } from "@/lib/themes";
import { cn } from "@/lib/utils";

const colors = [
  ["Desk", "--surface-desk"], ["Sheet", "--surface-sheet"],
  ["Overlay", "--surface-overlay"], ["Main text", "--text-primary"],
  ["Secondary text", "--text-secondary"], ["Primary action", "--action-primary"],
  ["Selection", "--selection"], ["Focus", "--focus-ring"],
] as const;

export default function DesignSystemPage() {
  const { setTheme, resolvedTheme } = useTheme();
  const [tab, setTab] = useState("workspace");
  const [agentOpen, setAgentOpen] = useState(true);
  const [added, setAdded] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function previewTheme(name: string) {
    const theme = findThemeByName(name);
    if (!theme) return;
    applyTheme(theme);
    setTheme(theme.type);
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-surface-desk text-ui text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-sidebar-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-document text-2xl tracking-tight">Cabinet</Link>
          <span className="text-meta text-ink-secondary">Design system</span>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Preview theme" defaultValue="" onChange={event => previewTheme(event.target.value)} className="h-8 max-w-40 rounded-control border border-input bg-surface-sheet px-2 text-meta">
            <option value="" disabled>Preview a theme</option>
            {THEMES.map(theme => <option key={theme.name} value={theme.name}>{theme.label}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => previewTheme(resolvedTheme === "dark" ? DEFAULT_THEME_PAIR.light : DEFAULT_THEME_PAIR.dark)}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 pt-3 sm:pe-3">
        <nav aria-label="Design system sections" className="hidden w-52 shrink-0 flex-col gap-1 px-4 py-3 md:flex">
          <p className="mb-4 px-2 text-meta text-ink-secondary">The research desk</p>
          {[{ id: "workspace", label: "Workspace", icon: FileText }, { id: "foundations", label: "Foundations", icon: Folder }].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={cn("flex h-[var(--row-height)] items-center gap-2 rounded-control px-2 text-start text-meta transition-colors hover:bg-surface-hover", tab === id ? "bg-selection font-medium text-selection-foreground" : "text-ink-secondary")}><Icon className="size-3.5" />{label}</button>
          ))}
          <p className="mt-auto px-2 pt-8 text-label leading-relaxed text-ink-secondary">Live shared components.<br />Illustrative content.</p>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[var(--toolbar-height)] shrink-0 items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-2 text-meta text-ink-secondary"><span>Design system</span><ChevronRight className="size-3" /><span className="text-foreground">{tab === "workspace" ? "Workspace" : "Foundations"}</span></div>
            <ToolbarButton className="hidden lg:inline-flex" label="Toggle agent preview" icon={PanelRight} iconOnly active={agentOpen} onClick={() => setAgentOpen(!agentOpen)} />
          </div>
          <FolderTabs className="ms-5" active={tab} onSelect={setTab} ariaLabel="Preview views" tabs={[{ id: "workspace", label: "Workspace" }, { id: "foundations", label: "Foundations" }]} />
          <ContentSheet>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
              <Toggle size="sm" aria-label="Bold"><strong>B</strong></Toggle>
              <Toggle size="sm" aria-label="Italic"><em>I</em></Toggle>
              <div className="ms-auto flex items-center gap-1 text-label text-ink-secondary"><Check className="size-3 text-status-success" />Component preview</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "workspace" ? (
                <div className="mx-auto max-w-[var(--reading-width)] px-6 py-10 sm:px-12">
                  <p className="mb-4 text-meta text-ink-secondary">Research memo · Sample content</p>
                  <div className="tiptap">
                    <h1>Amazon, through three lenses</h1>
                    <p className="text-ink-secondary">Business quality, price, and portfolio fit deserve their own answers.</p>
                    <p className="font-document text-2xl leading-relaxed">A great business still needs a sensible price.</p>
                    <p>This memo brings three independent perspectives into one place. The aim is to understand where the evidence agrees, where it conflicts, and what we still need to know.</p>
                    <h2>Start with the business</h2>
                    <p>Separate the retail engine from the cloud business. Look at the capital each requires, the durability of customer demand, and how much cash remains after reinvestment.</p>
                  </div>
                  <table className="my-6 w-full text-start text-meta">
                    <thead><tr className="border-b border-border text-label text-ink-secondary"><th className="py-3 text-start font-medium">Perspective</th><th className="py-3 text-start font-medium">Current assessment</th></tr></thead>
                    <tbody>
                      <tr className="border-b border-border"><td className="py-4">Business quality</td><td><StatusBadge tone="success" icon={CheckCircle2}>Reviewed</StatusBadge></td></tr>
                      <tr className="border-b border-border"><td className="py-4">Price &amp; value</td><td><StatusBadge tone="warning" icon={MessageCircleQuestion}>Needs input</StatusBadge></td></tr>
                      <tr className="border-b border-border"><td className="py-4">Portfolio fit</td><td><StatusBadge icon={Clock3}>Not assessed</StatusBadge></td></tr>
                    </tbody>
                  </table>
                  <p className="text-label leading-relaxed text-ink-secondary">Illustrative workflow. These labels are sample states, not investment conclusions.</p>
                  {added && <div className="tiptap mt-8"><h2>Next research steps</h2><p>Set a required return, compare a range of reinvestment assumptions, and document the evidence that would invalidate the thesis.</p></div>}
                </div>
              ) : (
                <div className="mx-auto max-w-[var(--reading-width)] space-y-8 px-6 py-10 sm:px-12">
                  <div><h1 className="font-document text-4xl tracking-tight">The working parts.</h1><p className="mt-3 text-ui leading-relaxed text-ink-secondary">Semantic roles stay consistent across light, dark, and expressive themes.</p></div>
                  <section aria-labelledby="palette-heading"><h2 id="palette-heading" className="mb-3 font-semibold">Surfaces &amp; color</h2><div className="grid gap-x-6 sm:grid-cols-2">{colors.map(([label, variable]) => <div key={variable} className="flex items-center gap-3 border-b border-border py-3"><span aria-hidden className="size-6 shrink-0 rounded-control border border-input" style={{ background: `var(${variable})` }} /><span className="text-meta">{label}</span><code className="ms-auto text-[10px] text-ink-secondary">{variable}</code></div>)}</div></section>
                  <section aria-labelledby="type-heading"><h2 id="type-heading" className="mb-3 font-semibold">Typography</h2><p className="font-document text-3xl">A place for thoughtful work.</p><p className="mt-3 text-ui">Inter for navigation, controls, and operational headings.</p><p className="mt-2 font-mono text-meta text-ink-secondary">JetBrains Mono · paths, code, execution details</p></section>
                  <section aria-labelledby="controls-heading"><h2 id="controls-heading" className="mb-3 font-semibold">Controls &amp; focus</h2><div className="flex flex-wrap items-center gap-3"><Button>Primary action</Button><Button variant="outline">Secondary</Button><Button variant="ghost">Quiet action</Button><Button variant="destructive">Delete</Button><Button disabled>Disabled</Button></div><label className="mt-4 block max-w-sm space-y-2"><span className="text-meta text-ink-secondary">Example input</span><Input placeholder="Search your library" /></label></section>
                  <section aria-labelledby="states-heading"><h2 id="states-heading" className="mb-3 font-semibold">Agent states</h2><div className="flex flex-wrap gap-2"><StatusBadge icon={Clock3}>Queued</StatusBadge><StatusBadge tone="running" icon={Loader2}>Running</StatusBadge><StatusBadge tone="warning" icon={MessageCircleQuestion}>Needs input</StatusBadge><StatusBadge tone="success" icon={CheckCircle2}>Completed</StatusBadge><StatusBadge tone="danger" icon={XCircle}>Failed</StatusBadge></div></section>
                  <section aria-labelledby="geometry-heading"><h2 id="geometry-heading" className="mb-3 font-semibold">Geometry &amp; motion</h2><p className="text-meta leading-6 text-ink-secondary">6px controls · 10px groups · 18px sheets<br />28px compact · 32px standard · 40px prominent controls<br />120ms feedback · 180ms menus · 240ms drawers<br />Reduced motion and visible keyboard focus throughout.</p></section>
                </div>
              )}
            </div>
          </ContentSheet>
        </main>

        {agentOpen && <aside aria-label="Agent preview" className="hidden w-80 shrink-0 flex-col ps-3 lg:flex">
          <div className="flex h-[var(--toolbar-height)] shrink-0 items-center px-3 text-meta font-medium">Agent workspace</div>
          <div className="h-[35px] shrink-0" />
          <section className="mb-3 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--sheet-radius)] bg-surface-sheet p-5 shadow-[var(--sheet-shadow)]">
            <div className="flex items-center justify-between gap-2"><h2 className="font-medium">Research assistant</h2><StatusBadge tone="warning" icon={Clock3}>Review</StatusBadge></div>
            <p className="my-5 rounded-group bg-surface-subtle p-3 text-meta leading-6">Compare the three perspectives and flag what I need to decide.</p>
            <div className="space-y-4">{["Read the research notes", "Compared the independent lenses", "Prepared a suggested next step"].map(label => <div key={label} className="flex items-center gap-2 text-meta"><CheckCircle2 className="size-3.5 shrink-0 text-status-success" />{label}</div>)}</div>
            <p className="my-5 text-meta leading-6">The next step depends on your required return. I’ve kept that decision open and drafted a short research plan.</p>
            <div className="rounded-group border border-card-edge p-3"><div className="flex items-center gap-2 text-meta font-medium"><FileText className="size-4 text-primary" />Next research steps</div><p className="mt-2 text-label text-ink-secondary">Suggested addition to this memo</p></div>
            <Button className="mt-4" disabled={added} onClick={() => { setAdded(true); setTab("workspace"); }}>{added ? <Check /> : <Plus />}{added ? "Added to memo" : "Add to memo"}</Button>
            <form className="mt-auto space-y-2 pt-8" onSubmit={event => { event.preventDefault(); if (message.trim()) { setSent(true); setMessage(""); } }}><label htmlFor="preview-message" className="text-label text-ink-secondary">Try the composer</label><Input id="preview-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="Ask about this document" /><Button type="submit" variant="outline" size="sm" className="w-full">Send preview message</Button><p role="status" className="text-label leading-relaxed text-ink-secondary">{sent ? "Preview only. No message was sent." : "Sample interactions only."}</p></form>
          </section>
        </aside>}
      </div>
    </div>
  );
}
