package restishzpan

import (
	"context"
	"fmt"
	"strings"

	"github.com/rest-sh/restish/v2/plugin"
)

const (
	opCreate   = "createObject"
	opPresign  = "presignObjectUploadParts"
	opComplete = "completeObjectUpload"
	opAbort    = "abortObjectUpload"
)

var restishOperationAliases = map[string][]string{
	opCreate:   {"create-object"},
	opPresign:  {"presign-object-upload-parts"},
	opComplete: {"complete-object-upload"},
	opAbort:    {"abort-object-upload"},
}

type operationSet struct {
	Create   plugin.APIOperation
	Presign  plugin.APIOperation
	Complete plugin.APIOperation
	Abort    plugin.APIOperation
}

func fetchOperations(ctx context.Context, h host, api, profile string) (operationSet, error) {
	spec, err := h.FetchAPISpecContext(ctx, api, profile)
	if err != nil {
		return operationSet{}, err
	}
	if spec.Error != "" {
		return operationSet{}, fmt.Errorf("%s", spec.Error)
	}
	ops := map[string]plugin.APIOperation{}
	for _, op := range spec.Operations {
		ops[op.ID] = op
	}
	required := map[string]string{
		opCreate:   "POST",
		opPresign:  "POST",
		opComplete: "POST",
		opAbort:    "DELETE",
	}
	matched := map[string]plugin.APIOperation{}
	for id, method := range required {
		op, ok := findOperation(ops, id)
		if !ok {
			return operationSet{}, fmt.Errorf("API %q is missing required operation %q", api, id)
		}
		if !strings.EqualFold(op.Method, method) {
			return operationSet{}, fmt.Errorf("operation %q uses %s, want %s", id, op.Method, method)
		}
		matched[id] = op
	}
	if err := validateCreateOperation(matched[opCreate]); err != nil {
		return operationSet{}, err
	}
	if err := validatePartsOperation(matched[opPresign], "partNumbers"); err != nil {
		return operationSet{}, err
	}
	if err := validatePartsOperation(matched[opComplete], "parts"); err != nil {
		return operationSet{}, err
	}
	for _, id := range []string{opPresign, opComplete, opAbort} {
		if err := requirePathParams(matched[id], "id", "uploadSessionId"); err != nil {
			return operationSet{}, fmt.Errorf("operation %q: %w", id, err)
		}
	}
	return operationSet{
		Create:   matched[opCreate],
		Presign:  matched[opPresign],
		Complete: matched[opComplete],
		Abort:    matched[opAbort],
	}, nil
}

func findOperation(ops map[string]plugin.APIOperation, id string) (plugin.APIOperation, bool) {
	if op, ok := ops[id]; ok {
		return op, true
	}
	for _, alias := range restishOperationAliases[id] {
		if op, ok := ops[alias]; ok {
			return op, true
		}
	}
	return plugin.APIOperation{}, false
}

func validateCreateOperation(op plugin.APIOperation) error {
	if !op.HasBody {
		return fmt.Errorf("operation %q must accept a JSON body", opCreate)
	}
	for _, name := range []string{"name", "type", "size", "parent", "onConflict"} {
		if !schemaHasProperty(op.RequestSchema, name) {
			return fmt.Errorf("operation %q request schema missing %q", opCreate, name)
		}
	}
	return nil
}

func validatePartsOperation(op plugin.APIOperation, property string) error {
	if !op.HasBody {
		return fmt.Errorf("operation %q must accept a JSON body", op.ID)
	}
	if !schemaHasProperty(op.RequestSchema, property) {
		return fmt.Errorf("operation %q request schema missing %q", op.ID, property)
	}
	return nil
}

func schemaHasProperty(schema map[string]any, name string) bool {
	if schema == nil {
		return false
	}
	if props, ok := schema["properties"].(map[string]any); ok {
		_, found := props[name]
		return found
	}
	for _, key := range []string{"allOf", "anyOf", "oneOf"} {
		items, ok := schema[key].([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			child, ok := item.(map[string]any)
			if ok && schemaHasProperty(child, name) {
				return true
			}
		}
	}
	return false
}

func requirePathParams(op plugin.APIOperation, names ...string) error {
	seen := map[string]bool{}
	for _, param := range op.Parameters {
		if param.In == "path" && param.Required {
			seen[param.Name] = true
		}
	}
	for _, name := range names {
		if !seen[name] {
			return fmt.Errorf("missing required path parameter %q", name)
		}
	}
	return nil
}
