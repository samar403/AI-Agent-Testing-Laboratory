import { PLANS } from "@agentlab/core/browser";
import { post, type Usage } from "../api.ts";
import { UsageBars } from "../components/Charts.tsx";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { int, usd, useApi, useToast } from "../lib.tsx";

export function Billing() {
  useCrumbs([{ label: "Usage & billing" }]);
  const toast = useToast();
  const { data, error, setData } = useApi<Usage>("/usage");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const days = Math.round((data.periodEnd - data.periodStart) / 86_400_000);
  const today = Math.floor((Date.now() - data.periodStart) / 86_400_000) + 1;
  const projected = today > 0 ? Math.round((data.trials / today) * days) : data.trials;
  const used = data.trials / data.plan.includedTrials;
  const period = `${new Date(data.periodStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(data.periodEnd - 1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return (
    <>
      <PageHead
        title={
          <>
            Usage & <em>billing</em>
          </>
        }
        sub="AgentLab is metered by trials — one simulated conversation, start to finish. Model tokens for Claude-powered agents, users and judges go to your own Anthropic account at cost."
      />
      <div className="grid g-4">
        <div className="panel reg stat">
          <span className="label">Current plan</span>
          <div className="v">{data.plan.name}</div>
          <div className="d">
            ${data.plan.price}/mo · {int(data.plan.includedTrials)} trials included
          </div>
        </div>
        <div className="panel reg stat">
          <span className="label">Trials this period</span>
          <div className="v">{int(data.trials)}</div>
          <div className="meter" style={{ marginTop: 6 }}>
            <span style={{ width: `${Math.min(100, used * 100)}%`, background: used > 1 ? "var(--warn)" : undefined }} />
          </div>
          <div className="d">
            {Math.round(used * 100)}% of included · {period}
          </div>
        </div>
        <div className="panel reg stat">
          <span className="label">Projected this period</span>
          <div className="v">{int(projected)}</div>
          <div className="d">at the current daily pace</div>
        </div>
        <div className="panel reg stat">
          <span className="label">Projected invoice</span>
          <div className="v">{usd(data.projectedInvoiceUsd)}</div>
          <div className="d">
            {data.overageTrials ? `${int(data.overageTrials)} overage trials · ${usd(data.overageUsd)}` : "no overage"} · est. model spend {usd(data.modelCostUsd)}
          </div>
        </div>
      </div>

      <section className="panel reg">
        <div className="panel-head">
          <h3>Trials per day</h3>
          <span className="right specimen-id">{period.toUpperCase()}</span>
        </div>
        <div className="panel-body">
          <UsageBars daily={data.daily} days={days} />
        </div>
      </section>

      <div className="grid g-3">
        {PLANS.map((p) => {
          const current = p.id === data.plan.id;
          return (
            <section key={p.id} className={`panel reg price ${current ? "hot" : ""}`}>
              <div className="row">
                <h3 style={{ fontSize: 18 }}>{p.name}</h3>
                {current && <span className="chip accent">current</span>}
              </div>
              <div className="amt">
                ${p.price}
                <small> / month</small>
              </div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {int(p.includedTrials)} trials · {p.overagePerTrial ? `$${p.overagePerTrial}/extra trial` : "hard cap"} · {p.seats} seats
              </div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button
                className={`btn ${current ? "" : "primary"}`}
                disabled={current}
                onClick={async () => {
                  try {
                    setData(await post<Usage>("/usage/plan", { planId: p.id }));
                    toast(`Switched to ${p.name}`);
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}
              >
                {current ? "Current plan" : `Switch to ${p.name}`}
              </button>
            </section>
          );
        })}
      </div>
      <p className="faint row" style={{ fontSize: 12.5 }}>
        <Icon name="alert" size={13} /> Self-hosted edition: plan changes apply immediately and invoices are projections. Connect a payment provider for live metered billing (see docs/deployment.md).
      </p>
    </>
  );
}
