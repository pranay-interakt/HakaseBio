"""Mechanistic credal graph: a monotone adverse-outcome-pathway (AOP) DAG over
which credal beliefs propagate by interval arithmetic.

Nodes are biological *key events* -- molecular initiating events (MIE),
intermediate key events (KE), and terminal adverse outcomes (AO). Directed edges
encode mechanistic causation with a coupling weight in ``[0, 1]``. Belief
propagation uses a *noisy-OR* link, which is the standard monotone combination
for causal graphs: a downstream key event becomes more likely as any upstream
driver becomes more likely, and the mapping stays within ``[0, 1]``.

Monotonicity of the link function is what makes interval propagation a *valid
enclosure*: the lower bound of a node is obtained from the lower bounds of its
parents and the upper bound from the upper bounds. This property is asserted by
the test suite, not merely assumed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .interval import Interval, combine_consensus


@dataclass(frozen=True)
class Edge:
    src: str
    dst: str
    weight: float  # coupling strength in [0, 1]

    def __post_init__(self) -> None:
        if not (0.0 <= self.weight <= 1.0):
            raise ValueError(f"edge weight must lie in [0, 1], got {self.weight}")


@dataclass
class CredalGraph:
    """A directed acyclic mechanistic graph of biological key events.

    Parameters
    ----------
    nodes:
        Ordered collection of node identifiers.
    edges:
        Directed edges ``(src -> dst)`` with coupling weights.
    adverse_outcomes:
        Subset of ``nodes`` that are terminal adverse outcomes; the safety
        decision reads liability off these nodes.
    """

    nodes: list[str]
    edges: list[Edge] = field(default_factory=list)
    adverse_outcomes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        node_set = set(self.nodes)
        if len(node_set) != len(self.nodes):
            raise ValueError("duplicate node identifiers are not allowed")
        for e in self.edges:
            if e.src not in node_set or e.dst not in node_set:
                raise ValueError(f"edge {e.src}->{e.dst} references unknown node")
        for ao in self.adverse_outcomes:
            if ao not in node_set:
                raise ValueError(f"adverse outcome '{ao}' is not a node")
        if not self.adverse_outcomes:
            raise ValueError("at least one adverse outcome node is required")
        self._parents: dict[str, list[Edge]] = {n: [] for n in self.nodes}
        for e in self.edges:
            self._parents[e.dst].append(e)
        self._order = self._topological_order()

    def _topological_order(self) -> list[str]:
        """Kahn's algorithm; raises if the graph contains a cycle."""
        indeg = {n: 0 for n in self.nodes}
        adj: dict[str, list[str]] = {n: [] for n in self.nodes}
        for e in self.edges:
            indeg[e.dst] += 1
            adj[e.src].append(e.dst)
        queue = [n for n in self.nodes if indeg[n] == 0]
        order: list[str] = []
        while queue:
            n = queue.pop(0)
            order.append(n)
            for m in adj[n]:
                indeg[m] -= 1
                if indeg[m] == 0:
                    queue.append(m)
        if len(order) != len(self.nodes):
            raise ValueError("mechanistic graph must be acyclic (cycle detected)")
        return order

    @property
    def topological_order(self) -> list[str]:
        return list(self._order)

    def parents(self, node: str) -> list[Edge]:
        return list(self._parents[node])

    def propagate(self, evidence: dict[str, Interval]) -> dict[str, Interval]:
        """Propagate credal evidence through the DAG in causal order.

        Parameters
        ----------
        evidence:
            Mapping from node id to a credal :class:`Interval` produced by the
            evidence layer (endpoint observations). Nodes absent from the mapping
            carry no direct observation and inherit belief from their parents.

        Returns
        -------
        dict
            Belief interval for every node.

        Notes
        -----
        For a node ``v`` with parents ``pa(v)`` the noisy-OR link is

            p(v) = 1 - prod_{u in pa(v)} (1 - w_{u->v} * p(u))

        applied bound-wise (lower bounds together, upper bounds together) because
        the link is non-decreasing in every parent. If the node also carries a
        direct observation, the observation and the parent-propagated interval are
        fused with :func:`combine_consensus` (agree -> narrow, conflict -> widen).
        A node with neither parents nor a direct observation is an unconstrained
        latent and is left at the maximally ignorant interval ``[0, 1]``.
        """
        for node, iv in evidence.items():
            if node not in self._parents:
                raise ValueError(f"evidence references unknown node '{node}'")
        belief: dict[str, Interval] = {}
        for node in self._order:
            parent_edges = self._parents[node]
            propagated: Interval | None = None
            if parent_edges:
                prod_lo = 1.0
                prod_hi = 1.0
                for e in parent_edges:
                    pu = belief[e.src]
                    prod_lo *= 1.0 - e.weight * pu.lo
                    prod_hi *= 1.0 - e.weight * pu.hi
                propagated = Interval(1.0 - prod_lo, 1.0 - prod_hi)

            obs = evidence.get(node)
            if obs is not None and propagated is not None:
                belief[node] = combine_consensus([obs, propagated])
            elif obs is not None:
                belief[node] = obs
            elif propagated is not None:
                belief[node] = propagated
            else:
                belief[node] = Interval(0.0, 1.0)
        return belief
