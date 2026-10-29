"""Registered-tool boundary for the isolated operation journal.

No HTTP endpoints, model loop, worker or external side effects. Trusted adapters
must check business preconditions and ownership inside the mutation transaction.
"""
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel
from .operation_protocol import Receipt, Strict, Wait


@dataclass(frozen=True)
class WaitSpec:
    card_type: str
    events: dict[str, type[Strict]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_model: type[Strict]
    result_model: type[Strict]
    execution_mode: Literal['sync', 'async']
    effect: Literal['read', 'draft', 'write', 'external']
    confirmation: Literal['none', 'required']
    timeout_seconds: int
    retry: Literal['never', 'same_operation']
    cancellation: Literal['unsupported', 'acknowledged']
    preconditions: tuple[str, ...]
    waits: tuple[WaitSpec, ...] = ()


class ToolRegistry:
    def __init__(self, specs):
        self._specs = {}
        for spec in specs:
            if not spec.name.strip() or spec.name in self._specs:
                raise ValueError('Empty or duplicate tool name')
            if (spec.execution_mode not in ('sync', 'async')
                    or spec.effect not in ('read', 'draft', 'write', 'external')
                    or spec.confirmation not in ('none', 'required')
                    or spec.retry not in ('never', 'same_operation')
                    or spec.cancellation not in ('unsupported', 'acknowledged')
                    or type(spec.timeout_seconds) is not int or spec.timeout_seconds <= 0):
                raise ValueError('Invalid execution policy')
            for model in (spec.input_model, spec.result_model):
                self._check_model(model)
            cards = set()
            # Copy mutable maps so subsequent caller edits cannot widen the catalog.
            waits = []
            for wait in spec.waits:
                if not wait.card_type.strip() or wait.card_type in cards or not wait.events:
                    raise ValueError('Invalid or duplicate wait card')
                cards.add(wait.card_type)
                for event, model in wait.events.items():
                    if not event.strip():
                        raise ValueError('Empty event name')
                    self._check_model(model)
                waits.append(WaitSpec(wait.card_type, dict(wait.events)))
            from dataclasses import replace
            self._specs[spec.name] = replace(spec, waits=tuple(waits))

    @staticmethod
    def _check_model(model):
        if not isinstance(model, type) or not issubclass(model, BaseModel):
            raise ValueError('Tool schemas must use Pydantic models')
        if model.model_config.get('extra') != 'forbid' or not model.model_config.get('strict'):
            raise ValueError('Tool schemas must reject extra fields and coercion')

    def get(self, name):
        if name not in self._specs:
            raise ValueError('Unregistered tool')
        # Avoid leaking the mutable event maps in our private registry.
        from dataclasses import replace
        spec = self._specs[name]
        return replace(spec, waits=tuple(WaitSpec(w.card_type, dict(w.events)) for w in spec.waits))

    def wait_spec(self, tool, card):
        for wait in self.get(tool).waits:
            if wait.card_type == card:
                return wait
        raise ValueError('Unregistered wait card')

    def catalog(self):
        return [dict(name=s.name, description=s.description,
                     input_schema=s.input_model.model_json_schema(),
                     result_schema=s.result_model.model_json_schema(),
                     execution_mode=s.execution_mode, effect=s.effect,
                     confirmation=s.confirmation, timeout_seconds=s.timeout_seconds,
                     retry=s.retry, cancellation=s.cancellation, preconditions=list(s.preconditions),
                     waits=[dict(card_type=w.card_type, events={
                         name: model.model_json_schema() for name, model in w.events.items()}) for w in s.waits])
                for s in self._specs.values()]


class ToolRuntime:
    def __init__(self, store, registry):
        self.store = store
        self.registry = registry

    def accept(self, owner, session, operation, task, revision, tool, arguments, *, confirmed=False):
        """Caller must authorize tool/preconditions and resolve confirmation evidence.

        confirmed is a trusted adapter input, never model-supplied JSON. No
        confirmation-token verification is implemented in this isolated slice.
        """
        spec = self.registry.get(tool)
        values = spec.input_model.model_validate(arguments).model_dump()
        if spec.confirmation == 'required' and confirmed is not True:
            raise ValueError('Explicit confirmation required')
        return self.store.accept(owner, session, operation, task, revision, tool, values)

    def change(self, owner, session, operation, command, seq, revision, status, **values):
        call = self.store.get_call(owner, session, operation)
        spec = self.registry.get(call['tool'])
        if status == 'succeeded':
            values['result'] = spec.result_model.model_validate(values.get('result')).model_dump()
        if status == 'waiting_user':
            wait = Wait.model_validate(values.get('wait'))
            registered = self.registry.wait_spec(spec.name, wait.card_type)
            if not set(wait.allowed_events) <= set(registered.events):
                raise ValueError('Unregistered wait event')
            values['wait'] = wait.model_dump()
        if status == 'waiting_external' and spec.execution_mode != 'async':
            raise ValueError('Synchronous tool cannot wait for external work')
        if status == 'cancel_request' and spec.cancellation == 'unsupported':
            raise ValueError('Tool does not support cancellation')
        if values.get('mutate') is not None and spec.effect == 'read':
            raise ValueError('Read-only tool cannot mutate task state')
        if values.get('wait_response') is not None:
            raise ValueError('Use validated resume for user responses')
        return self.store.change(owner, session, operation, command, seq, revision, status, **values)

    def resume(self, owner, session, operation, command, seq, revision, *,
               wait_id, event, payload, mutate=None):
        call = self.store.get_call(owner, session, operation)
        spec = self.registry.get(call['tool'])
        if mutate is not None and spec.effect == 'read':
            raise ValueError('Read-only tool cannot mutate task state')
        # Wait descriptor from the original command is retained for idempotent
        # resume after success/restart; store performs the atomic version check.
        wait = self.store.wait_descriptor(owner, session, operation, wait_id)
        registered = self.registry.wait_spec(spec.name, wait['card_type'])
        if event not in wait['allowed_events'] or event not in registered.events:
            raise ValueError('Unregistered wait event')
        validated = registered.events[event].model_validate(payload).model_dump()
        return self.store.change(owner, session, operation, command, seq, revision, 'running',
            wait_response={'wait_id': wait_id, 'event': event},
            business_input=validated, mutate=mutate)
