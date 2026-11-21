#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
setup_engine
require_env
assert_resources
report_status
