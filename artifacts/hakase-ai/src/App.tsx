import { Router as WouterRouter, Route, Switch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { HakaseAI } from "@/pages/HakaseAI";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={Login} />
          <Route path="/dashboard" component={HakaseAI} />
          <Route path="/dashboard/:rest*" component={HakaseAI} />
          <Route component={Landing} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
