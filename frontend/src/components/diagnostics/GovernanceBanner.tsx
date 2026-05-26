import { Badge } from "@/components/ui/badge";

import { Card } from "@/components/ui/card";

import type { GovernanceConfig } from "@/types/diagnostics";



type GovernanceBannerProps = {

  governance?: GovernanceConfig;

};



export function GovernanceBanner({ governance }: GovernanceBannerProps) {

  if (!governance) return null;

  return (

    <Card className="p-3 flex flex-wrap items-center gap-2 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-950">

      <Badge className="bg-slate-800 text-white dark:bg-slate-700">Thresholds</Badge>

      {governance.csi && (

        <Badge variant="outline" className="bg-white dark:bg-slate-900">CSI stable &lt; {governance.csi.stable_max}</Badge>

      )}

      {governance.psi_score && (

        <Badge variant="outline" className="bg-white dark:bg-slate-900">PSI stable &lt; {governance.psi_score.stable_max}</Badge>

      )}

      {governance.iv && (

        <Badge variant="outline" className="bg-white dark:bg-slate-900">IV significant ≤ {governance.iv.significant_decline}</Badge>

      )}

      {governance.missing && (

        <Badge variant="outline" className="bg-white dark:bg-slate-900">Missing flag &gt; {governance.missing.flag_delta_pp} pp</Badge>

      )}

    </Card>

  );

}

