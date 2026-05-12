import { Router as WouterRouter, Route, Switch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={Login} />
          <Route path="/story" component={Story} />
          <Route path="/platform" component={Platform} />
          <Route path="/regulatory" component={Regulatory} />
          <Route path="/apis" component={APIs} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/advanced-v2" component={AdvancedV2} />
          <Route path="/haiopsdna" component={HAIOps} />
          <Route path="/ivive" component={IVIVE} />
          <Route path="/dashboard" component={HakaseAI} />
          <Route path="/dashboard/:rest*" component={HakaseAI} />
          <Route component={Landing} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
