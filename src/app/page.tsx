import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

// M0 scaffold: a proof that the prototype's tokens, both faces and the shadcn
// components render together. M2 replaces this page with the create form.

const SWATCHES = [
  { name: "paper", className: "bg-paper" },
  { name: "paper-2", className: "bg-paper-2" },
  { name: "paper-3", className: "bg-paper-3" },
  { name: "rule", className: "bg-rule" },
  { name: "ink-2", className: "bg-ink-2" },
  { name: "ink", className: "bg-ink" },
  { name: "brand", className: "bg-brand" },
  { name: "cool", className: "bg-cool" },
  { name: "ok", className: "bg-ok" },
  { name: "bad", className: "bg-bad" },
] as const;

const SCALE = [
  { token: "3xl", className: "text-3xl" },
  { token: "2xl", className: "text-2xl" },
  { token: "xl", className: "text-xl" },
  { token: "lg", className: "text-lg" },
  { token: "md", className: "text-md" },
  { token: "sm", className: "text-sm" },
  { token: "xs", className: "text-xs" },
] as const;

export default function Page() {
  return (
    <main className="container-page flex flex-col gap-16 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          Project 25 · scaffold
        </p>
        <h1>Paste</h1>
        <p className="text-ink-2 text-lg">
          Paste once; the link keeps answering.
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2>Type scale</h2>
        <dl className="flex flex-col gap-2">
          {SCALE.map(({ token, className }) => (
            <div key={token} className="flex items-baseline gap-4">
              <dt className="num text-muted-foreground w-12 shrink-0 font-mono text-xs">
                {token}
              </dt>
              <dd className={className}>Immutable bytes, permanent link</dd>
            </div>
          ))}
        </dl>
        <p className="font-mono text-sm">
          at com.foo.Bar.baz(Bar.java:42) — Atkinson Hyperlegible Mono, the face
          every body and log renders in
        </p>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2>Palette</h2>
        <ul className="flex flex-wrap gap-3">
          {SWATCHES.map(({ name, className }) => (
            <li key={name} className="flex flex-col gap-1">
              <span
                className={`border-rule block size-16 rounded-md border ${className}`}
              />
              <span className="text-muted-foreground font-mono text-xs">
                {name}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2>Components</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Save</Button>
          <Button variant="secondary">Preview</Button>
          <Button variant="outline">View raw</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Redact</Button>
          <Badge>log</Badge>
          <Badge variant="secondary">30 days</Badge>
          <Badge variant="destructive">tier 1</Badge>
        </div>
        <div className="flex max-w-lg flex-col gap-3">
          <Input placeholder="Title (optional)" />
          <Textarea placeholder="Paste text here" rows={4} />
        </div>
      </section>
    </main>
  );
}
