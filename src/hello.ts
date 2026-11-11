// Placeholder graph so `npm run dev` has something to serve. Replace with the CodeClimb graphs.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const State = Annotation.Root({
  name: Annotation<string>,
  greeting: Annotation<string>,
});

export const graph = new StateGraph(State)
  .addNode("greet", (state) => ({ greeting: `Hello, ${state.name ?? "codeclimb"}` }))
  .addEdge(START, "greet")
  .addEdge("greet", END)
  .compile();
