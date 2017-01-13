//--------------------------------------------------------------------------------------------------
// Copyright (c) YugaByte, Inc.
//--------------------------------------------------------------------------------------------------

#include <stdio.h>

#include "yb/sql/parser/parse_context.h"
#include "yb/util/logging.h"

namespace yb {
namespace sql {

using std::endl;
using std::istream;
using std::min;
using std::string;

//--------------------------------------------------------------------------------------------------
// ParseContext
//--------------------------------------------------------------------------------------------------

ParseContext::ParseContext(const char *stmt, size_t stmt_len)
    : ProcessContext(stmt, stmt_len),
      stmt_offset_(0),
      trace_scanning_(false),
      trace_parsing_(false) {

  // The MAC version of FLEX requires empty or valid input stream. It does not allow input file to
  // be nullptr.
  sql_file_ = std::unique_ptr<istream>(new istream(nullptr));

  if (VLOG_IS_ON(3)) {
    trace_scanning_ = true;
    trace_parsing_ = true;
  }
}

ParseContext::~ParseContext() {
}

//--------------------------------------------------------------------------------------------------

size_t ParseContext::Read(char* buf, size_t max_size) {
  const size_t copy_size = min<size_t>(stmt_len_ - stmt_offset_, max_size);
  if (copy_size > 0) {
    memcpy(buf, stmt_ + stmt_offset_, copy_size);
    stmt_offset_ += copy_size;
    return copy_size;
  }
  return 0;
}

}  // namespace sql
}  // namespace yb
