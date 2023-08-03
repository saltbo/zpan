package authz

import future.keywords.contains
import future.keywords.if
import future.keywords.in

default allow := true

allow := false {
    input.resource.data.uid != input.uid
}