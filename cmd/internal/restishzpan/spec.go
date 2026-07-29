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
	for id, method := range required {
		op, ok := ops[id]
		if !ok {
			return operationSet{}, fmt.Errorf("API %q is missing required operation %q", api, id)
		}
		if !strings.EqualFold(op.Method, method) {
			return operationSet{}, fmt.Errorf("operation %q uses %s, want %s", id, op.Method, method)
		}
	}
	if err := validateCreateOperation(ops[opCreate]); err != nil {
		return operationSet{}, err
	}
	if err := validatePartsOperation(ops[opPresign], "partNumbers"); err != nil {
		return operationSet{}, err
	}
	if err := validatePartsOperation(ops[opComplete], "parts"); err != nil {
		return operationSet{}, err
	}
	for _, id := range []string{opPresign, opComplete, opAbort} {
		if err := requirePathParams(ops[id], "id", "uploadSessionId"); err != nil {
			return operationSet{}, fmt.Errorf("operation %q: %w", id, err)
		}
	}
	return operationSet{
		Create:   ops[opCreate],
		Presign:  ops[opPresign],
		Complete: ops[opComplete],
		Abort:    ops[opAbort],
	}, nil
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
