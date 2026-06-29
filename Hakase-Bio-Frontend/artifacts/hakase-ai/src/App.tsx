import { Router as WouterRouter, Route, Switch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "@/lib/AuthContext";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { HakaseAI } from "@/pages/HakaseAI";
import { Story } from "@/pages/Story";
import { Platform } from "@/pages/Platform";
import { Regulatory } from "@/pages/Regulatory";
import { APIs } from "@/pages/APIs";
import { Privacy } from "@/pages/Privacy";
import { AdvancedV2 } from "@/pages/AdvancedV2";
import { HAIOps } from "@/pages/HAIOps";
import { IVIVE } from "@/pages/IVIVE";
import BatchScreen from "@/pages/BatchScreen";
import { LabDashboard } from "@/pages/LabDashboard";

const queryClient = new QueryClient();

const gated = (C: React.ComponentType<any>) => (props: any) =>
  (
    <ProtectedRoute>
      <C {...props} />
    </ProtectedRoute>
  );

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            {/* Public marketing */}
            <Route path="/" component={Landing} />
            <Route path="/login" component={Login} />
            <Route path="/story" component={Story} />
            <Route path="/platform" component={Platform} />
            <Route path="/regulatory" component={Regulatory} />
            <Route path="/apis" component={APIs} />
            <Route path="/privacy" component={Privacy} />

            {/* Authenticated workspace */}
            <Route path="/advanced-v2" component={gated(AdvancedV2)} />
            <Route path="/haiopsdna" component={gated(HAIOps)} />
            <Route path="/ivive" component={gated(IVIVE)} />
            <Route path="/screen" component={gated(BatchScreen)} />
            <Route path="/lab" component={gated(LabDashboard)} />
            <Route path="/dashboard" component={gated(HakaseAI)} />
            <Route path="/dashboard/:rest*" component={gated(HakaseAI)} />

            <Route component={Landing} />
          </Switch>
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
