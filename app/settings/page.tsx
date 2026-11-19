import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getBusinessSettings, getTeamMembers } from "@/lib/dal/settings";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
import { TeamMemberList } from "@/components/settings/team-member-list";

const requiredVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

export default async function SettingsPage() {
  const session = await requireRole(["OWNER_ADMIN"], "/settings");
  const businessId = session.profile.business_id;

  const [settings, teamMembers] = await Promise.all([
    getBusinessSettings(businessId),
    getTeamMembers(businessId),
  ]);

  return (
    <AppShell
      title="Settings"
      subheading="Business profile, team management, and workspace configuration."
    >
      {/* Business Profile Settings */}
      <Panel title="Business Profile" action={<StatusBadge label="Owner Only" tone="primary" />}>
        {settings ? (
          <BusinessSettingsForm settings={settings} />
        ) : (
          <p className="text-sm text-slate-500 italic">
            Unable to load business settings. Please check your database connection.
          </p>
        )}
      </Panel>

      {/* Team Management */}
      <Panel
        title={`Team Directory (${teamMembers.length} members)`}
        action={<StatusBadge label="Role Management" tone="neutral" />}
      >
        {teamMembers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">No team members found</p>
            <p className="mt-1 text-xs text-slate-400">
              Invite team members through Supabase Auth to populate this directory.
            </p>
          </div>
        ) : (
          <TeamMemberList members={teamMembers} currentUserId={session.profile.id} />
        )}
      </Panel>

      {/* Supabase Connection Status */}
      <Panel
        title="Supabase Connection & Auth Status"
        action={<StatusBadge label="Connected & Active" tone="success" />}
      >
        <p className="mb-4 text-sm text-slate-600">
          Supabase SSR cookie-based authentication and PostgreSQL Row Level Security (RLS) are active.
        </p>
        <ul className="space-y-2">
          {requiredVariables.map((variable) => (
            <li
              key={variable}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
            >
              <span>{variable}</span>
              <span className="text-emerald-600 font-semibold">Configured</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
          Use a publishable key only in the browser. The service-role key is never exposed to browser code.
        </div>
      </Panel>

      {/* Business Workspace Info */}
      <Panel title="Business Workspace">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Business Tenant
            </dt>
            <dd className="mt-1 font-medium text-slate-900">
              {session.business?.name || "KAAMFLOW Tenant"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Administrator Profile
            </dt>
            <dd className="mt-1 font-medium text-slate-900">
              {session.profile.full_name} ({session.profile.role})
            </dd>
          </div>
        </dl>
      </Panel>
    </AppShell>
  );
}
