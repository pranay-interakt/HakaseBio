import { Router as WouterRouter, Route, Switch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HakaseAI } from "@/pages/HakaseAI";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Switch>
          <Route path="/" component={HakaseAI} />
          <Route path="/:rest*" component={HakaseAI} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
