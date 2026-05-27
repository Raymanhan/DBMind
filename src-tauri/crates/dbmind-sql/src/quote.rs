/// Pre-process SQL to backtick-quote unquoted identifiers that contain hyphens.
///
/// MySQL interprets `auth-cloud` as `auth - cloud` (subtraction), causing
/// syntax errors. This function wraps such identifiers in backticks.
use std::fmt::Write;

/// Quote unquoted identifiers containing hyphens that would cause MySQL errors.
pub fn quote_identifiers(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len() + 32);
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];
        if c == '`' {
            result.push('`');
            i += 1;
            while i < len && chars[i] != '`' {
                result.push(chars[i]);
                i += 1;
            }
            if i < len {
                result.push('`');
                i += 1;
            }
        } else if c == '\'' {
            result.push('\'');
            i += 1;
            while i < len && chars[i] != '\'' {
                if chars[i] == '\\' && i + 1 < len {
                    result.push(chars[i]);
                    i += 1;
                }
                result.push(chars[i]);
                i += 1;
            }
            if i < len {
                result.push('\'');
                i += 1;
            }
        } else if c == '"' {
            result.push('"');
            i += 1;
            while i < len && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < len {
                    result.push(chars[i]);
                    i += 1;
                }
                result.push(chars[i]);
                i += 1;
            }
            if i < len {
                result.push('"');
                i += 1;
            }
        } else if c == '-' && i + 1 < len && chars[i + 1] == '-' {
            // Line comment: copy everything until end of line as-is
            while i < len && chars[i] != '\n' {
                result.push(chars[i]);
                i += 1;
            }
        } else if c == '/' && i + 1 < len && chars[i + 1] == '*' {
            // Block comment: copy everything until */ as-is
            result.push(chars[i]);
            i += 1;
            result.push(chars[i]);
            i += 1;
            while i < len {
                if chars[i] == '*' && i + 1 < len && chars[i + 1] == '/' {
                    result.push(chars[i]);
                    i += 1;
                    result.push(chars[i]);
                    i += 1;
                    break;
                }
                result.push(chars[i]);
                i += 1;
            }
        } else if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            // Collect the full word from the chars Vec, then write it as a String
            let start = i;
            while i < len {
                let cc = chars[i];
                if cc.is_ascii_alphanumeric() || cc == '_' || cc == '-' {
                    i += 1;
                } else {
                    break;
                }
            }
            // Build word from char slice — this avoids byte-index issues
            let word: String = chars[start..i].iter().collect();

            if word.contains('-') {
                let preceded_by_backtick = start > 0 && chars[start - 1] == '`';
                let preceded_by_dot = start > 0 && chars[start - 1] == '.';
                let followed_by_dot = i < len && chars[i] == '.';

                if preceded_by_backtick {
                    result.push_str(&word);
                } else if followed_by_dot {
                    let _ = write!(result, "`{}`", word);
                } else if preceded_by_dot {
                    let _ = write!(result, "`{}`", word);
                } else {
                    let _ = write!(result, "`{}`", word);
                }
            } else {
                result.push_str(&word);
            }
        } else {
            result.push(c);
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_word_with_underscore() {
        assert_eq!(quote_identifiers("del_flag"), "del_flag");
        assert_eq!(quote_identifiers("dept_users"), "dept_users");
        assert_eq!(quote_identifiers("user_id"), "user_id");
    }

    #[test]
    fn test_coalesce() {
        assert_eq!(quote_identifiers("COALESCE"), "COALESCE");
    }

    #[test]
    fn test_simple_sql() {
        let sql = "AND del_flag = 0";
        assert_eq!(quote_identifiers(sql), "AND del_flag = 0");
    }

    #[test]
    fn test_after_chinese_string() {
        let sql = "nick_name = '王俊文'\n      AND del_flag = 0";
        let result = quote_identifiers(sql);
        assert_eq!(result, sql, "Wrong result after Chinese string");
    }

    #[test]
    fn test_quote_database_with_hyphen() {
        assert_eq!(quote_identifiers("SELECT * FROM auth-cloud.sys_user"),
                   "SELECT * FROM `auth-cloud`.sys_user");
    }

    #[test]
    fn test_no_double_quote() {
        assert_eq!(quote_identifiers("SELECT * FROM `auth-cloud`.sys_user"),
                   "SELECT * FROM `auth-cloud`.sys_user");
    }

    #[test]
    fn test_full_query() {
        let sql = "SELECT u.nick_name FROM auth-cloud.sys_user_dept ud INNER JOIN auth-cloud.sys_user u ON ud.user_id = u.user_id LEFT JOIN ylb_daily_log.daily_log_detail d ON ud.id = d.user_dept_id";
        let expected = "SELECT u.nick_name FROM `auth-cloud`.sys_user_dept ud INNER JOIN `auth-cloud`.sys_user u ON ud.user_id = u.user_id LEFT JOIN ylb_daily_log.daily_log_detail d ON ud.id = d.user_dept_id";
        assert_eq!(quote_identifiers(sql), expected);
    }

    #[test]
    fn test_skip_string_literal() {
        let sql = "SELECT * FROM auth-cloud.users WHERE name = 'auth-cloud'";
        let result = quote_identifiers(sql);
        assert_eq!(result, "SELECT * FROM `auth-cloud`.users WHERE name = 'auth-cloud'");
    }

    #[test]
    fn test_line_comment_preserved() {
        let sql = "SELECT 1 -- this is a comment";
        assert_eq!(quote_identifiers(sql), "SELECT 1 -- this is a comment");
    }

    #[test]
    fn test_line_comment_with_following_sql() {
        let sql = "SELECT 1 -- comment\nWHERE id = 1";
        assert_eq!(quote_identifiers(sql), "SELECT 1 -- comment\nWHERE id = 1");
    }

    #[test]
    fn test_line_comment_with_semicolon() {
        let sql = "SELECT 1 -- ; not a separator\nFROM users;";
        assert_eq!(quote_identifiers(sql), "SELECT 1 -- ; not a separator\nFROM users;");
    }

    #[test]
    fn test_block_comment_preserved() {
        let sql = "SELECT /* comment */ 1";
        assert_eq!(quote_identifiers(sql), "SELECT /* comment */ 1");
    }

    #[test]
    fn test_cte_query_with_hyphen() {
        let sql = "WITH target_dept_ids AS (
    SELECT DISTINCT dept_id
    FROM `auth-cloud`.`sys_user_dept`
    WHERE user_id = (SELECT user_id FROM `auth-cloud`.`sys_user` WHERE nick_name = '王俊文')
      AND del_flag = 0
),
dept_users AS (
    SELECT DISTINCT user_id
    FROM `auth-cloud`.`sys_user_dept`
    WHERE dept_id IN (SELECT dept_id FROM target_dept_ids)
      AND del_flag = 0
)
SELECT 
    u.user_id,
    u.nick_name,
    COALESCE(SUM(dd.over_duration), 0) AS total_overtime_hours
FROM `auth-cloud`.`sys_user` u
JOIN dept_users du ON u.user_id = du.user_id
LEFT JOIN `ylb_daily_log`.`daily_log_detail` dd
    ON u.user_id = (SELECT user_id FROM `auth-cloud`.`sys_user_dept` WHERE id = dd.user_dept_id LIMIT 1)
    AND dd.create_time >= '2026-05-01 00:00:00'
    AND dd.create_time < '2026-06-01 00:00:00'
    AND dd.is_valid = 1
GROUP BY u.user_id, u.nick_name
ORDER BY total_overtime_hours DESC;";
        let result = quote_identifiers(sql);
        assert!(result.contains("`auth-cloud`"), "`auth-cloud` missing");
        assert!(result.contains("`ylb_daily_log`"), "`ylb_daily_log` missing");
        assert!(result.contains("del_flag"), "del_flag missing in:\n{}", result);
        assert!(result.contains("dept_users"), "dept_users missing");
        assert!(result.contains("COALESCE"), "COALESCE missing");
        assert!(result.contains("total_overtime_hours"), "total_overtime_hours missing");
    }
}
