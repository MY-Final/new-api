package billingexpr

import (
	"fmt"
	"math"

	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/parser"
)

// SubscriptionCostUpperBound bounds every possible pricing branch over the
// admitted input and output quantities. Conditional branches are both bounded:
// evaluating only c=max_output_tokens can underestimate a non-monotone price.
// Arbitrary request-derived numeric prices and unbounded operations are rejected.
func SubscriptionCostUpperBound(expression string, inputTokens, outputTokens int) (float64, error) {
	if inputTokens < 0 || outputTokens <= 0 {
		return 0, fmt.Errorf("invalid subscription token budget")
	}
	if _, err := CompileFromCache(expression); err != nil {
		return 0, err
	}
	_, body := ParseExprVersion(expression)
	tree, err := parser.Parse(body)
	if err != nil {
		return 0, err
	}
	bound, err := subscriptionPriceRange(tree.Node, float64(inputTokens), float64(outputTokens))
	if err != nil {
		return 0, err
	}
	if bound.high <= 0 || math.IsNaN(bound.high) || math.IsInf(bound.high, 0) {
		return 0, fmt.Errorf("subscription model price must have a finite positive budget")
	}
	return bound.high, nil
}

type subscriptionCostRange struct {
	low, high float64
}

func subscriptionPriceRange(node ast.Node, input, output float64) (subscriptionCostRange, error) {
	var result subscriptionCostRange
	switch part := node.(type) {
	case *ast.IntegerNode:
		result.low, result.high = float64(part.Value), float64(part.Value)
	case *ast.FloatNode:
		result.low, result.high = part.Value, part.Value
	case *ast.IdentifierNode:
		switch part.Value {
		case "p", "len", "cr", "cc", "cc1h", "cc12h", "img", "img_cr", "ai":
			result.high = input
		case "c", "img_o", "ao":
			result.high = output
		case "image_count":
			result.low, result.high = 1, 1
		default:
			return result, fmt.Errorf("subscription pricing cannot bound %q", part.Value)
		}
	case *ast.UnaryNode:
		value, err := subscriptionPriceRange(part.Node, input, output)
		if err != nil {
			return result, err
		}
		switch part.Operator {
		case "+":
			result = value
		case "-":
			result.low, result.high = -value.high, -value.low
		default:
			return result, fmt.Errorf("subscription pricing cannot bound unary %q", part.Operator)
		}
	case *ast.BinaryNode:
		left, err := subscriptionPriceRange(part.Left, input, output)
		if err != nil {
			return result, err
		}
		right, err := subscriptionPriceRange(part.Right, input, output)
		if err != nil {
			return result, err
		}
		switch part.Operator {
		case "+":
			result.low, result.high = left.low+right.low, left.high+right.high
		case "-":
			result.low, result.high = left.low-right.high, left.high-right.low
		case "*", "/":
			if part.Operator == "/" {
				if right.low <= 0 && right.high >= 0 {
					return result, fmt.Errorf("subscription pricing denominator may be zero")
				}
				right.low, right.high = 1/right.high, 1/right.low
			}
			products := []float64{left.low * right.low, left.low * right.high, left.high * right.low, left.high * right.high}
			result.low, result.high = products[0], products[0]
			for _, value := range products[1:] {
				result.low, result.high = min(result.low, value), max(result.high, value)
			}
		default:
			return result, fmt.Errorf("subscription pricing cannot bound operator %q", part.Operator)
		}
	case *ast.ConditionalNode:
		left, err := subscriptionPriceRange(part.Exp1, input, output)
		if err != nil {
			return result, err
		}
		right, err := subscriptionPriceRange(part.Exp2, input, output)
		if err != nil {
			return result, err
		}
		result.low, result.high = min(left.low, right.low), max(left.high, right.high)
	case *ast.CallNode:
		name, ok := part.Callee.(*ast.IdentifierNode)
		if !ok {
			return result, fmt.Errorf("subscription pricing cannot bound indirect calls")
		}
		arguments := part.Arguments
		if name.Value == "tier" && len(arguments) == 2 {
			return subscriptionPriceRange(arguments[1], input, output)
		}
		if len(arguments) == 0 || len(arguments) > 2 {
			return result, fmt.Errorf("subscription pricing cannot bound %q", name.Value)
		}
		first, err := subscriptionPriceRange(arguments[0], input, output)
		if err != nil {
			return result, err
		}
		switch name.Value {
		case "fixed":
			result.low, result.high = first.low*1_000_000, first.high*1_000_000
		case "ceil":
			result.low, result.high = math.Ceil(first.low), math.Ceil(first.high)
		case "floor":
			result.low, result.high = math.Floor(first.low), math.Floor(first.high)
		case "abs":
			result.high = max(math.Abs(first.low), math.Abs(first.high))
			if first.low > 0 || first.high < 0 {
				result.low = min(math.Abs(first.low), math.Abs(first.high))
			}
		case "min", "max":
			if len(arguments) != 2 {
				return result, fmt.Errorf("subscription pricing requires two arguments to %q", name.Value)
			}
			second, err := subscriptionPriceRange(arguments[1], input, output)
			if err != nil {
				return result, err
			}
			if name.Value == "min" {
				result.low, result.high = min(first.low, second.low), min(first.high, second.high)
			} else {
				result.low, result.high = max(first.low, second.low), max(first.high, second.high)
			}
		default:
			return result, fmt.Errorf("subscription pricing cannot bound function %q", name.Value)
		}
	default:
		return result, fmt.Errorf("subscription pricing contains an unsupported cost expression")
	}
	if math.IsNaN(result.low) || math.IsNaN(result.high) || math.IsInf(result.low, 0) || math.IsInf(result.high, 0) {
		return result, fmt.Errorf("subscription pricing bound is not finite")
	}
	return result, nil
}
