"""Source-bound native file registration; importing this module performs no IO."""
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlsplit
import uuid
import nexvia_generated_callback as generated_callback

REGISTRATION_PROTOCOL_VERSION = 2
ORIGIN = "https://lennox.nexvia.com.au"
# Historical v3 evidence only. Protocol 2 binds the live raw hash per page.
DONE_SOURCE_SHA256 = "6bca1e312639e1f418f8da27b980417500364820031430f277eed15fe59498bf"
SEND_SOURCE_SHA256 = "96bfef70560ed8611fb07bbc0321d5d7dbbdf8b938dd08c4f92438398d3b4b16"
PREFIX_SHA256 = "99865d2b4faa2b895f45e7aa108017ffbf1f4d8025119878530ce1eb8d3c1486"
QUERY_SHA256 = "e6eaea18e885e1078829b56df34896be5ab51439e8f0ba00cb1624b2c572c10e"
SIGNED_FIELDS = frozenset({"key", "policy", "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-signature"})
RENDERER_PREFIX = "/staff/upload/details/"
_DANGEROUS_MEMBERS = frozenset({"__proto__", "prototype", "constructor"})
_ARRAY_OBJECT_MEMBERS = _DANGEROUS_MEMBERS | frozenset("""
    __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ hasOwnProperty
    isPrototypeOf propertyIsEnumerable valueOf toLocaleString toString length at concat
    copyWithin entries every fill filter find findIndex findLast findLastIndex flat flatMap
    forEach includes indexOf join keys lastIndexOf map pop push reduce reduceRight reverse
    shift slice some sort splice toReversed toSorted toSpliced unshift values with
""".split())
PUBLIC_FAILURE_CODES = frozenset({
    "registration_callback_metadata", "registration_contract_invalid", "registration_controller_missing",
    "registration_controller_namespace", "registration_controller_not_data", "registration_done_source_changed",
    "registration_file_alias", "registration_file_url_source", "registration_native_id", "registration_native_metadata",
    "registration_policy_binding", "registration_policy_root", "registration_primary_get", "registration_query_source",
    "registration_renderer_query", "registration_renderer_source", "registration_renderer_template",
    "registration_route_branch", "registration_route_prefix", "registration_scope_metadata",
    "registration_send_source_changed", "registration_signed_key_binding", "registration_signed_root",
    "registration_source_arrow", "registration_source_comment", "registration_source_function", "registration_source_limit",
    "registration_source_object", "registration_source_regex", "registration_source_statement", "registration_source_string",
    "registration_source_structure", "registration_source_template", "registration_url_source",
    "registration_done_profile_changed", "registration_network_inventory", "registration_source_provenance",
})


class RegistrationError(ValueError):
    """Only fixed, non-private reasons escape this module."""


def require(value, code):
    if not value: raise RegistrationError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _literal(source, start):
    quote, value, index = source[start], [], start + 1
    escapes = {"n":"\n", "r":"\r", "t":"\t", "b":"\b", "f":"\f", "v":"\v", "0":"\0"}
    while index < len(source):
        character = source[index]
        if character == quote: return "".join(value), index + 1
        require(character not in "\r\n", "registration_source_string")
        if character != "\\": value.append(character); index += 1; continue
        index += 1
        require(index < len(source), "registration_source_string")
        character = source[index]
        if character in {"u", "x"}:
            count = 4 if character == "u" else 2
            digits = source[index + 1:index + 1 + count]
            require(len(digits) == count and re.fullmatch(r"[a-fA-F0-9]+", digits), "registration_source_string")
            value.append(chr(int(digits, 16))); index += count + 1
        else:
            require(character not in "\r\n" and not character.isdigit(), "registration_source_string")
            value.append(escapes.get(character, character)); index += 1
    raise RegistrationError("registration_source_string")


def _tokens(source, *, pinned_send=False):
    # The immutable SEND callback contains native filename-normalizer regexes.
    # Only its exact reviewed bytes may make those bodies opaque; DONE remains
    # strict even if a later syntax profile were accidentally broadened.
    if pinned_send:
        require(pinned_send is True and isinstance(source, str) and 0 < len(source) <= 65536
                and hashlib.sha256(source.encode()).hexdigest() == SEND_SOURCE_SHA256,
                "registration_send_source_changed")
    tokens, index, previous = [], 0, ""
    while index < len(source):
        require(len(tokens) < 40000, "registration_source_limit")
        rest, character = source[index:], source[index]
        if character.isspace(): index += 1; continue
        if rest.startswith("//"):
            end = source.find("\n", index + 2); index = len(source) if end < 0 else end; continue
        if rest.startswith("/*"):
            end = source.find("*/", index + 2); require(end >= 0, "registration_source_comment"); index = end + 2; continue
        if character in "\"'":
            value, index = _literal(source, index); tokens.append(("string", value))
        elif character == "`": raise RegistrationError("registration_source_template")
        elif character == "/" and previous in {"", "(", "=", ":", ",", "return", "!", "[", "?"}:
            cursor, bracket = index + 1, False
            while cursor < len(source):
                if source[cursor] == "\\": cursor += 2; continue
                if source[cursor] == "[": bracket = True
                elif source[cursor] == "]": bracket = False
                elif source[cursor] == "/" and not bracket: break
                cursor += 1
            require(cursor < len(source), "registration_source_regex")
            cursor += 1
            while cursor < len(source) and source[cursor].isalpha(): cursor += 1
            require(pinned_send is True, "registration_source_regex")
            tokens.append(("regex", "")); index = cursor
        elif re.match(r"[A-Za-z_$]", character):
            word = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group(); tokens.append(("id", word)); index += len(word)
        elif character.isascii() and character.isdigit():
            word = re.match(r"[0-9][A-Za-z0-9_.]*", rest).group(); tokens.append(("number", word)); index += len(word)
        else:
            operator = next((word for word in ("===", "!==", "==", "!=", "&&", "||", "=>", "+=", "-=") if rest.startswith(word)), character)
            tokens.append(("punct", operator)); index += len(operator)
        previous = tokens[-1][1]
    return tokens


def _balanced(tokens, start):
    pairs = {"(":")", "[":"]", "{":"}"}
    require(tokens[start][1] in pairs, "registration_source_structure")
    stack = [pairs[tokens[start][1]]]
    for index in range(start + 1, len(tokens)):
        kind, value = tokens[index]
        if kind != "punct": continue
        if value in pairs: stack.append(pairs[value])
        elif value in pairs.values():
            require(stack and stack.pop() == value, "registration_source_structure")
            if not stack: return index
    raise RegistrationError("registration_source_structure")


def _split(tokens, separator):
    groups, start, index = [], 0, 0
    while index < len(tokens):
        if tokens[index][0] == "punct" and tokens[index][1] in {"(", "[", "{"}: index = _balanced(tokens, index) + 1; continue
        if tokens[index] == ("punct", separator): groups.append(tokens[start:index]); start = index + 1
        index += 1
    return groups + [tokens[start:]]


def _member(tokens):
    if not tokens or tokens[0][0] != "id": return None
    path, index = [tokens[0][1]], 1
    while index < len(tokens):
        if index + 1 < len(tokens) and tokens[index] == ("punct", ".") and tokens[index + 1][0] == "id":
            path.append(tokens[index + 1][1]); index += 2
        elif index + 2 < len(tokens) and tokens[index] == ("punct", "[") and tokens[index + 1][0] in {"string", "number"} and tokens[index + 2] == ("punct", "]"):
            path.append(tokens[index + 1][1]); index += 3
        else: return None
    return path


def _fields(tokens):
    require(tokens and tokens[0] == ("punct", "{") and _balanced(tokens, 0) == len(tokens) - 1, "registration_source_object")
    result = {}
    for row in _split(tokens[1:-1], ","):
        require(len(row) >= 3 and row[0][0] in {"id", "string"} and row[1] == ("punct", ":") and row[0][1] not in result, "registration_source_object")
        result[row[0][1]] = row[2:]
    return result


def _functions(tokens):
    spans = []
    for index, token in enumerate(tokens):
        if token == ("punct", "=>"): raise RegistrationError("registration_source_arrow")
        if token != ("id", "function"): continue
        left = index + 1
        if tokens[left][0] == "id": left += 1
        require(tokens[left] == ("punct", "("), "registration_source_function")
        right = _balanced(tokens, left)
        require(tokens[right + 1] == ("punct", "{"), "registration_source_function")
        spans.append((right + 1, _balanced(tokens, right + 1)))
    require(spans and spans[0][1] == len(tokens) - 1, "registration_source_function")
    return spans


def _depth(index, spans): return sum(left < index < right for left, right in spans) - 1


def _statement(tokens, start):
    index = start
    while index < len(tokens):
        if tokens[index] in {("punct", ";"), ("punct", "}")}: return tokens[start:index]
        if tokens[index][0] == "punct" and tokens[index][1] in {"(", "[", "{"}: index = _balanced(tokens, index)
        index += 1
    raise RegistrationError("registration_source_statement")


def _file_alias(tokens, spans):
    aliases = []
    for index in range(1, len(tokens)):
        if tokens[index] == ("punct", "=") and _depth(index, spans) == 0 and tokens[index - 1][0] == "id":
            path = _member(_statement(tokens, index + 1))
            if path and len(path) == 3 and path[1:] == ["files", "0"]: aliases.append(tokens[index - 1][1])
    require(len(aliases) == 1, "registration_file_alias")
    return aliases[0]


def _primary_get(tokens, spans):
    found = []
    for index in range(len(tokens) - 4):
        if tokens[index:index + 4] == [("punct", "."), ("id", "ajax"), ("punct", "("), ("punct", "{")] and _depth(index, spans) == 0:
            fields = _fields(tokens[index + 3:_balanced(tokens, index + 3) + 1])
            if fields.get("type") == [("string", "GET")]: found.append((index, fields))
    require(len(found) == 1, "registration_primary_get")
    return found[0]


def _display_gate_evals(tokens, spans):
    """Prove only the two native boolean display gates, without executing JS.

    The exact DONE profile is checked first by _source_contract. Match its entire
    gate prelude too: [] has no entries or these non-inherited properties, so the
    metadata copy and arbitrary-string override cannot run. Every live input
    starts as a boolean string and has just its one native normalizer assignment.
    """
    sites = [index for index, token in enumerate(tokens) if token[0] in {"id", "string"} and token[1] == "eval"]
    if not sites: return set()
    code = "registration_network_inventory"
    require(len(sites) == 2 and all(tokens[index] == ("id", "eval") and _depth(index, spans) == 0 for index in sites), code)
    loops = []
    for index in range(len(tokens) - 9):
        if (tokens[index:index+3] != [("id", "for"), ("punct", "("), ("id", "let")]
                or tokens[index+3][0] != "id"
                or tokens[index+4:index+10] != [("id", "in"), ("id", "data"), ("punct", "."),
                                                 ("id", "files"), ("punct", ")"), ("punct", "{")]): continue
        end = _balanced(tokens, index+9)
        if _depth(index, spans) == 0 and all(index+9 < site < end for site in sites):
            loops.append((index+10, end, tokens[index+3][1]))
    require(len(loops) == 1, code)
    start, end, loop = loops[0]
    gates = []
    for site in sites:
        require(tokens[site+1:site+2] == [("punct", "(")], code)
        close = _balanced(tokens, site+1)
        arguments = tokens[site+2:close]
        require(len(arguments) == 3 and arguments[0][0] == "string"
                and arguments[1] == ("punct", "+") and arguments[2][0] == "id", code)
        assignment = re.fullmatch(r"\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*", arguments[0][1])
        require(assignment is not None, code)
        target, argument = assignment[1], arguments[2][1]
        # In this profile the whole gate is one if block with a local boolean,
        # one normalizer call, the standalone eval, and its immediate file store.
        gate_start = site - 23
        require(gate_start >= start and site+19 < end, code)
        gate = tokens[gate_start:site+19]
        require(all(gate[offset][0] == "id" for offset in (12, 14, 18)) and gate[20][0] == "string", code)
        owner, normalizer, keys, mode = (gate[offset][1] for offset in (12, 14, 18, 20))
        expected = _tokens(f"""if ({argument}) {{ let {target}=false;
            {argument}={owner}.{normalizer}({argument},{keys},{json.dumps(mode)});
            eval({json.dumps(arguments[0][1])}+{argument});
            data.files[{loop}].{target}={target}; }}""")
        require(gate == expected, code)
        gates.append((gate_start, site+19, target, argument, owner, normalizer, keys))
    first, second = gates
    require(first[1] == second[0] and first[4:] == second[4:], code)
    prelude = tokens[start:first[0]]
    require(len(prelude) >= 21 and all(prelude[offset][0] == "id" for offset in (1, 7, 12, 17)), code)
    metadata, enabled, argument1, argument2 = (prelude[offset][1] for offset in (1, 7, 12, 17))
    require((argument1, argument2) == (first[3], second[3]), code)
    strings = [value for kind, value in prelude if kind == "string"]
    require(len(strings) == 6 and strings[0] in {"true", "false"} and strings[1] in {"true", "false"}
            and all(key not in _ARRAY_OBJECT_MEMBERS for key in strings[2:5]), code)
    copy_loops = [index for index in range(len(prelude)-3)
                  if prelude[index:index+3] == [("id", "for"), ("punct", "("), ("id", "let")]]
    require(len(copy_loops) == 2 and prelude[copy_loops[0]+3][0] == "id", code)
    field = prelude[copy_loops[0]+3][1]
    keys = first[6]
    roles = {metadata, enabled, argument1, argument2, field, keys, first[2], second[2], loop}
    require(len(roles) == 9 and not roles & {"data", "id", "eval", first[4], first[5]}, code)
    initial1, initial2, metadata_key, file_key, guard_key, inactive_value = map(json.dumps, strings)
    expected = _tokens(f"""let {metadata}=[]; let {enabled}=true;
        let {argument1}={initial1}; let {argument2}={initial2};
        if ({metadata}) {{ for (let {field} in {metadata}) {{
            data.files[{loop}][{field}]={metadata}[{field}]; }} }}
        if ({enabled}) {{ if ({metadata}[{metadata_key}] === data.files[{loop}][{file_key}]
                && {metadata}[{guard_key}]) {{ {argument1}={inactive_value}; }} }}
        let {keys}=[];
        if ({argument1} || {argument2}) {{ for (let id in data.files[{loop}]) {{ {keys}.push(id); }} }}""")
    require(prelude == expected, code)
    # These let bindings cannot escape or gain another write in the file loop.
    require(not any(kind == "id" and value in roles - {loop}
                    for kind, value in tokens[second[1]:end]), code)
    return set(sites)


def _done_inventory(tokens, spans):
    """The supported body has one outer jQuery AJAX and one nested PDF-gated submit."""
    forbidden = {"fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "send", "sendAsBinary", "load",
                 "eval", "Function", "execScript", "importScripts", "import", "require", "getScript", "getJSON",
                 "open", "setAttribute", "defineProperty"}
    display_evals = _display_gate_evals(tokens, spans)
    require(not any(kind in {"id","string"} and value in forbidden | _DANGEROUS_MEMBERS and index not in display_evals
                    for index,(kind,value) in enumerate(tokens)),
            "registration_network_inventory")
    ajax, submits = [], []
    for index,token in enumerate(tokens):
        if token == ("id","ajax"):
            require(index >= 2 and tokens[index-2:index] == [("id","$"),("punct",".")]
                    and tokens[index+1:index+3] == [("punct","("),("punct","{")]
                    and _depth(index,spans) == 0, "registration_network_inventory")
            ajax.append(index)
        if token[0] in {"id","string"} and token[1] in {"get","post","send","submit"}:
            if tokens[index-1:index] != [("punct",".")]: continue
            require(token[1] == "submit" and tokens[index-2:index] == [("id","data"),("punct",".")]
                    and tokens[index+1:index+3] == [("punct","("),("punct",")")]
                    and _depth(index,spans) == 1, "registration_network_inventory")
            submits.append(index)
    require(len(ajax) == len(submits) == 1, "registration_network_inventory")


def _namespace_predicates(tokens, spans):
    """Read controller literals from the immutable SEND, never from a guess."""
    result = []
    for index in range(len(tokens)-1):
        if tokens[index:index+2] != [("id","if"),("punct","(")] or _depth(index,spans) != 0: continue
        end = _balanced(tokens,index+1)
        comparisons = _split(tokens[index+2:end],"||")
        if len(comparisons) < 2 or not all(len(row) == 3 and row[0][0] == "id"
                and row[1] == ("punct","===") and row[2][0] == "string" for row in comparisons): continue
        controller = comparisons[0][0][1]
        if all(row[0] == ("id",controller) for row in comparisons):
            result.append((controller,[row[2][1] for row in comparisons]))
    return result


def _writes_before(tokens, end, prefix):
    """Find assignments to a critical member/alias without evaluating source."""
    found = []
    for index in range(end):
        if tokens[index][1] not in {"=","+=","-=","++","--"}: continue
        for start in range(max(0,index-12),index):
            path = _member(tokens[start:index])
            if path and path[:len(prefix)] == prefix:
                found.append((index,path)); break
    return found


def _source_contract(done, send):
    try: syntax = generated_callback.profile(done)
    except generated_callback.CallbackProfileError as error:
        raise RegistrationError(str(error)) from None
    require(isinstance(send, str) and 0 < len(send) <= 65536 and hashlib.sha256(send.encode()).hexdigest() == SEND_SOURCE_SHA256, "registration_send_source_changed")
    st = _tokens(send, pinned_send=True); sf = _functions(st); send_file = _file_alias(st, sf)
    namespaces = _namespace_predicates(st,sf)
    require(len(namespaces) == 1, "registration_route_branch")
    _, ajax = _primary_get(st, sf)
    require(ajax.get("async") == [("id", "false")], "registration_policy_root")
    success = ajax.get("success", [])
    require(len(success) >= 10 and success[:2] == [("id", "function"), ("punct", "(")], "registration_policy_root")
    end = _balanced(success, 1)
    parameters = _split(success[2:end], ",")
    require(parameters and len(parameters[0]) == 1 and parameters[0][0][0] == "id" and success[end + 1] == ("punct", "{")
            and _balanced(success, end + 1) == len(success) - 1, "registration_policy_root")
    body = success[end + 2:-1]
    if body and body[-1] == ("punct", ";"): body = body[:-1]
    require(len(body) == 5 and body[0] == ("id", send_file) and body[1] == ("punct", ".") and body[2][0] == "id"
            and body[3:] == [("punct", "="), parameters[0][0]], "registration_policy_root")
    cache = body[2][1]
    require(cache not in _DANGEROUS_MEMBERS, "registration_policy_root")
    signed = set()
    for index in range(len(st) - 3):
        if st[index:index + 3] != [("punct", "."), ("id", "append"), ("punct", "(")]: continue
        arguments = _split(st[index + 3:_balanced(st, index + 2)], ",")
        if len(arguments) == 2 and len(arguments[0]) == 1 and arguments[0][0][0] == "string":
            field = arguments[0][0][1]
            if field in SIGNED_FIELDS and _member(arguments[1]) == [send_file, cache, field]: signed.add(field)
    require(signed == SIGNED_FIELDS, "registration_signed_root")
    dt = _tokens(done); df = _functions(dt); done_file = _file_alias(dt, df)
    _done_inventory(dt,df)
    position, ajax = _primary_get(dt, df)
    require(set(ajax) == {"url","type","dataType","data","async"}
            and ajax["type"] == [("string","GET")] and ajax["dataType"] == [("string","json")]
            and ajax["async"] == [("id","true")], "registration_primary_get")
    query = _fields(ajax.get("data", []))
    require(len(query) == 1, "registration_query_source")
    query_key, query_value = next(iter(query.items()))
    require(hashlib.sha256(query_key.encode()).hexdigest() == QUERY_SHA256 and query_key == "location"
            and _member(query_value) == [done_file, cache, "path"], "registration_query_source")
    url = _split(ajax.get("url", []), "+")
    require(len(url) == 2 and len(url[0]) == 1 and url[0][0][0] == "id"
            and _member(url[1]) == [done_file, cache, "id"], "registration_url_source")
    route_name = url[0][0][1]
    require(not _writes_before(dt,position,[done_file,cache]), "registration_source_provenance")
    require(any(dt[index:index + 4] == [("id", done_file), ("punct", "."), ("id", "url"), ("punct", "=")]
                and _depth(index, df) == 0 and _member(_statement(dt, index + 4)) == [done_file, cache, "path"] for index in range(len(dt) - 4)), "registration_file_url_source")
    branches = []
    for index in range(position):
        if dt[index:index + 2] != [("id", "if"), ("punct", "(")] or _depth(index, df) != 0: continue
        end = _balanced(dt, index + 1)
        comparisons = _split(dt[index + 2:end], "||")
        if not comparisons or not all(len(row) == 3 and row[0][0] == "id" and row[1] == ("punct", "===") and row[2][0] == "string" for row in comparisons): continue
        controller = comparisons[0][0][1]
        if not all(row[0] == ("id", controller) for row in comparisons): continue
        if dt[end + 1] != ("punct", "{"): continue
        close = _balanced(dt, end + 1)
        if dt[close + 1:close + 3] != [("id", "else"), ("punct", "{")]: continue
        other = _balanced(dt, close + 2)
        left, right = dt[end + 2:close], dt[close + 3:other]
        if left and left[-1] == ("punct", ";"): left = left[:-1]
        if right and right[-1] == ("punct", ";"): right = right[:-1]
        if len(left) != 3 or left[:2] != [("id", route_name), ("punct", "=")] or left[2][0] != "string": continue
        prefix = left[2][1]
        if hashlib.sha256(prefix.encode()).hexdigest() != PREFIX_SHA256: continue
        require(right == [("id", route_name), ("punct", "="), ("string", "/"), ("punct", "+"), ("id", controller), ("punct", "+"), ("string", prefix)], "registration_route_branch")
        branches.append((controller, [row[2][1] for row in comparisons], prefix, end+2,close+3,other))
    require(len(branches) == 1, "registration_route_branch")
    controller, accepted, prefix, first_write, second_write, _ = branches[0]
    require(controller == namespaces[0][0] and set(accepted) == set(namespaces[0][1]), "registration_route_branch")
    require([index for index,path in _writes_before(dt,position,[route_name])]
            == [first_write+1,second_write+1]
            and not _writes_before(dt,position,[controller]), "registration_source_provenance")
    require(0 < len(prefix) <= 1000 and prefix.isascii() and prefix.startswith("/") and prefix.endswith("/")
            and "//" not in prefix and all(re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in prefix.split("/")[1:-1]),
            "registration_route_prefix")
    return {"controllerVariable": controller, "acceptedControllers": accepted, "rootPrefix": prefix,
            "cacheProperty": cache, "queryKey": query_key, "nativeIdField": "id", "metadataField": "path",
            "doneSourceSha256":syntax["doneSourceSha256"], "doneProfileSha256":syntax["doneProfileSha256"]}


DONE_METADATA_JS = r"""(() => {
 const own=(o,k)=>{if(!o||!['object','function'].includes(typeof o))return undefined;const d=Object.getOwnPropertyDescriptor(o,k);return d&&Object.prototype.hasOwnProperty.call(d,'value')?d.value:undefined;};
 const inputs=[...document.querySelectorAll('input[type="file"]')];if(inputs.length!==1)throw Error('metadata');
 const jq=own(window,'jQuery')||own(window,'$');if(typeof jq!=='function')throw Error('metadata');
 const cache=jq(inputs[0]).data(),found=[];for(const d of Object.values(Object.getOwnPropertyDescriptors(cache||{}))){if(!Object.prototype.hasOwnProperty.call(d,'value'))continue;const options=own(d.value,'options'),callback=own(options,'done');if(typeof callback==='function'&&!found.includes(callback))found.push(callback);}
 if(found.length!==1)throw Error('metadata');return {callback:found[0],source:Function.prototype.toString.call(found[0])};
})()"""


def _properties(session, identifier):
    result = session.send("Runtime.getProperties", {"objectId":identifier,"ownProperties":True,"accessorPropertiesOnly":False,"generatePreview":False})
    require("exceptionDetails" not in result and isinstance(result.get("result"), list), "registration_scope_metadata")
    return result


def _controller(page, source, name):
    session, group = page.context.new_cdp_session(page), "registration-" + uuid.uuid4().hex
    try:
        result = session.send("Runtime.evaluate", {"expression":DONE_METADATA_JS,"returnByValue":False,"generatePreview":False,"objectGroup":group,"silent":True})
        require("exceptionDetails" not in result and isinstance(result.get("result",{}).get("objectId"),str), "registration_callback_metadata")
        properties = _properties(session, result["result"]["objectId"])["result"]
        values = {}
        for descriptor in properties:
            if descriptor.get("name") in {"callback","source"}:
                require("get" not in descriptor and "set" not in descriptor and isinstance(descriptor.get("value"),dict), "registration_callback_metadata")
                values[descriptor["name"]] = descriptor["value"]
        require(set(values) == {"callback","source"} and values["source"].get("type") == "string" and values["source"].get("value") == source
                and values["callback"].get("type") == "function" and isinstance(values["callback"].get("objectId"),str), "registration_done_source_changed")
        scopes = [value.get("value",{}) for value in _properties(session,values["callback"]["objectId"]).get("internalProperties",[]) if value.get("name") == "[[Scopes]]"]
        require(len(scopes) == 1 and isinstance(scopes[0].get("objectId"),str), "registration_scope_metadata")
        indexed = [row for row in _properties(session,scopes[0]["objectId"])["result"] if isinstance(row.get("name"),str) and row["name"].isdigit()]
        require(0 < len(indexed) <= 32, "registration_scope_metadata")
        for row in sorted(indexed,key=lambda value:int(value["name"])):
            scope = row.get("value",{})
            if scope.get("description") == "Global": continue
            require(isinstance(scope.get("objectId"),str), "registration_scope_metadata")
            matched = [value for value in _properties(session,scope["objectId"])["result"] if value.get("name") == name]
            if not matched: continue
            require(len(matched) == 1 and "get" not in matched[0] and "set" not in matched[0], "registration_controller_not_data")
            value = matched[0].get("value",{})
            require(value.get("type") == "string" and isinstance(value.get("value"),str)
                    and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}",value["value"]), "registration_controller_namespace")
            return value["value"]
        raise RegistrationError("registration_controller_missing")
    finally:
        try: session.send("Runtime.releaseObjectGroup",{"objectGroup":group})
        except Exception: pass
        try: session.detach()
        except Exception: pass


RENDER_SOURCES_JS = r"""args => {
 const values=[];
 for(const script of document.scripts){
  if(script.src)continue;
  const source=script.textContent;
  if(typeof source==='string'&&source.length<=262144&&source.includes(args.send)&&source.includes(args.done))values.push(source);
  if(values.length>4)throw Error('renderer source limit');
 }
 return values;
}"""


def _render_member(tokens):
    """A file member path with one explicit data.files[index] selection."""
    if not tokens or tokens[0][0] != "id": return None
    path, index = [tokens[0][1]], 1
    while index < len(tokens):
        if index + 1 < len(tokens) and tokens[index] == ("punct", ".") and tokens[index + 1][0] == "id":
            path.append(tokens[index + 1][1]); index += 2
        elif index + 2 < len(tokens) and tokens[index] == ("punct", "[") and tokens[index + 2] == ("punct", "]"):
            kind, value = tokens[index + 1]
            if kind == "string": path.append(value)
            elif kind in {"id", "number"} and path[-1] == "files": path.append((kind, value))
            else: return None
            index += 3
        else: return None
    return path


def _renderer_suffix(suffix):
    require(isinstance(suffix,str) and 0 < len(suffix) <= 1000 and suffix.isascii()
            and suffix.startswith("?") and not re.search(r"[\x00-\x20\x7f\\]",suffix)
            and not re.search(r"%(?![a-fA-F0-9]{2})",suffix), "registration_renderer_query")
    parsed = urlsplit(suffix)
    require(not parsed.path and not parsed.fragment, "registration_renderer_query")
    try:
        pairs = parse_qsl(parsed.query,keep_blank_values=True,strict_parsing=True,max_num_fields=4,errors="strict")
    except (ValueError,UnicodeError):
        raise RegistrationError("registration_renderer_query") from None
    require(pairs and len(pairs) == len(dict(pairs)) and any(value in {"form[Files]","form[Files][]"} for _,value in pairs),
            "registration_renderer_query")
    for key,value in pairs:
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,79}",key)
                and not re.search(r"delete|remove|send|email|approve|save|print|action|operation|method|callback",key,re.I)
                and (re.fullmatch(r"[0-9]{1,20}",value) is not None if key == "_" else value in {"form[Files]","form[Files][]"}),
                "registration_renderer_query")
    return pairs


def _renderer_contract(sources, done_source, send_source, cache):
    require(isinstance(sources,list) and 0 < len(sources) <= 4, "registration_renderer_source")
    for source in sources:
        require(isinstance(source,str) and len(source) <= 262144 and done_source in source and send_source in source,
                "registration_renderer_source")
    # Inline ownership is required, but unrelated inline expressions are never
    # eligible renderer evidence. Inspect only this exact live DONE callback.
    tokens = _tokens(done_source)
    spans = _functions(tokens)
    file_alias = _file_alias(tokens,spans)
    loops = []
    for index,token in enumerate(tokens):
        if token != ("id","for") or _depth(index,spans) != 0 or tokens[index+1:index+2] != [("punct","(")]: continue
        end = _balanced(tokens,index+1)
        header = tokens[index+2:end]
        if len(header) == 6 and header[0] == ("id","let") and header[1][0] == "id" \
                and header[2:] == [("id","in"),("id","data"),("punct","."),("id","files")] \
                and tokens[end+1:end+2] == [("punct","{")]:
            loops.append((end+1,_balanced(tokens,end+1),header[1][1]))
    found = []
    for index,token in enumerate(tokens):
        if _depth(index,spans) != 0: continue
        if token != ("punct","="): continue
        try: expression = _statement(tokens,index + 1)
        except RegistrationError: continue
        parts = _split(expression,"+")
        if len(parts) != 3 or parts[0] != [("string",RENDERER_PREFIX)] \
                or len(parts[2]) != 1 or parts[2][0][0] != "string": continue
        target = _render_member(parts[1])
        if target is None or target[-2:] != [cache,"id"]: continue
        file_path = target[:-2]
        if file_path == [file_alias]: pass
        elif len(file_path) == 3 and file_path[:2] == ["data","files"] \
                and isinstance(file_path[2],tuple) and file_path[2][0] == "id" \
                and any(left < index < right and variable == file_path[2][1] for left,right,variable in loops): pass
        else: continue
        # The URL must be stored on this same file, not on an unrelated
        # global or a different preview file selected elsewhere.
        left = next((_render_member(tokens[start:index]) for start in range(max(0,index - 30),index)
                     if _render_member(tokens[start:index]) is not None),None)
        if left is None or left[:-1] != file_path or not isinstance(left[-1],str) \
                or left[-1] in _DANGEROUS_MEMBERS: continue
        suffix = parts[2][0][1]
        _renderer_suffix(suffix)
        value = {"prefix":RENDERER_PREFIX,"suffix":suffix,
                 "templateHash":digest({"prefix":RENDERER_PREFIX,"suffix":suffix,"cacheProperty":cache})}
        if value not in found: found.append(value)
    require(len(found) == 1, "registration_renderer_template")
    return found[0]


def read_contract(page, done_source, send_source):
    parsed = _source_contract(done_source, send_source)
    controller = _controller(page,done_source,parsed["controllerVariable"])
    sources = page.evaluate(RENDER_SOURCES_JS,{"done":done_source,"send":send_source})
    renderer = _renderer_contract(sources,done_source,send_source,parsed["cacheProperty"])
    root = parsed["rootPrefix"]
    selected = root if controller in parsed["acceptedControllers"] else "/" + controller + root
    contract = {"version":REGISTRATION_PROTOCOL_VERSION,"origin":ORIGIN,
                "doneSourceSha256":parsed["doneSourceSha256"],"doneProfileSha256":parsed["doneProfileSha256"],
                "sendSourceSha256":SEND_SOURCE_SHA256,
                "prefixSha256":PREFIX_SHA256,"rootPrefix":root,"selectedPathPrefix":selected,"controller":controller,
                **{key:parsed[key] for key in ("cacheProperty","queryKey","nativeIdField","metadataField")},
                "renderer":renderer}
    contract["contractHash"] = digest(contract)
    return contract


def _check_contract(contract):
    require(isinstance(contract,dict) and contract.get("contractHash") == digest({key:value for key,value in contract.items() if key != "contractHash"})
            and type(contract.get("version")) is int and contract["version"] == REGISTRATION_PROTOCOL_VERSION and contract.get("origin") == ORIGIN
            and isinstance(contract.get("doneSourceSha256"),str) and re.fullmatch(r"[a-f0-9]{64}",contract["doneSourceSha256"])
            and contract.get("doneProfileSha256") == generated_callback.SUPPORTED_DONE_PROFILE_SHA256
            and contract.get("sendSourceSha256") == SEND_SOURCE_SHA256
            and contract.get("prefixSha256") == PREFIX_SHA256 and isinstance(contract.get("rootPrefix"),str)
            and hashlib.sha256(contract["rootPrefix"].encode()).hexdigest() == PREFIX_SHA256
            and isinstance(contract.get("controller"),str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}",contract["controller"])
            and isinstance(contract.get("cacheProperty"),str) and re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]{0,79}",contract["cacheProperty"])
            and contract["cacheProperty"] not in _DANGEROUS_MEMBERS
            and isinstance(contract.get("selectedPathPrefix"),str)
            and contract["selectedPathPrefix"] in {contract["rootPrefix"],"/"+contract["controller"]+contract["rootPrefix"]}
            and contract.get("queryKey") == "location" and contract.get("nativeIdField") == "id" and contract.get("metadataField") == "path",
            "registration_contract_invalid")
    renderer = contract.get("renderer")
    require(isinstance(renderer,dict) and set(renderer) == {"prefix","suffix","templateHash"}
            and renderer.get("prefix") == RENDERER_PREFIX
            and renderer.get("templateHash") == digest({"prefix":RENDERER_PREFIX,"suffix":renderer.get("suffix"),
                                                      "cacheProperty":contract.get("cacheProperty")}),
            "registration_contract_invalid")
    _renderer_suffix(renderer["suffix"])


def binding_from_policy(root, contract, candidates, quote=None):
    _check_contract(contract)
    require(isinstance(root,dict) and isinstance(candidates,list), "registration_policy_binding")
    native = root.get(contract["nativeIdField"])
    require(type(native) in {int,str} and re.fullmatch(r"[1-9][0-9]{0,15}",str(native)) and int(native) <= 9007199254740991, "registration_native_id")
    location = root.get(contract["metadataField"])
    require(isinstance(location,str) and 0 < len(location) <= 16384 and not re.search(r"[\x00-\x1f\x7f]",location), "registration_native_metadata")
    matches = [row for row in candidates if isinstance(row,dict) and row.get("pdf") is True and isinstance(row.get("fields"),dict)
               and all(isinstance(root.get(field),str) and root[field] == row["fields"].get(field) for field in SIGNED_FIELDS)]
    require(len(matches) == 1, "registration_signed_key_binding")
    fields = {field:root[field] for field in SIGNED_FIELDS}
    binding = {"version":REGISTRATION_PROTOCOL_VERSION,"nativeFileId":int(native),"exactLocation":location,"signedKey":root["key"],
               "registrationURL":ORIGIN+contract["selectedPathPrefix"]+str(native),"queryKey":contract["queryKey"],
               "rendererURL":ORIGIN+contract["renderer"]["prefix"]+str(native)+contract["renderer"]["suffix"],
               "signedFieldsDigest":digest(fields),"contractHash":contract["contractHash"],
               "doneSourceSha256":contract["doneSourceSha256"],"doneProfileSha256":contract["doneProfileSha256"],
               "sendSourceSha256":SEND_SOURCE_SHA256}
    binding["bindingHash"] = digest(binding)
    return binding


def matches_request(url, method, binding):
    try:
        if not isinstance(binding,dict) or binding.get("bindingHash") != digest({key:value for key,value in binding.items() if key != "bindingHash"}): return False
        if method != "GET" or not isinstance(url,str) or len(url) > 64000 or re.search(r"[\x00-\x20\x7f\\]",url): return False
        target, expected = urlsplit(url), urlsplit(binding["registrationURL"])
        if target.scheme != "https" or target.netloc != "lennox.nexvia.com.au" or target.fragment or target.path != expected.path: return False
        if re.search(r"%(?![a-fA-F0-9]{2})",target.query): return False
        pairs = parse_qsl(target.query,keep_blank_values=True,strict_parsing=True,max_num_fields=2,errors="strict")
        values = dict(pairs)
        return len(values) == len(pairs) and set(values) in ({binding["queryKey"]},{binding["queryKey"],"_"}) \
            and values[binding["queryKey"]] == binding["exactLocation"] \
            and ("_" not in values or re.fullmatch(r"[0-9]{1,20}",values["_"]) is not None)
    except (ValueError,TypeError,KeyError,UnicodeError): return False


def registration_request(request,binding):
    return matches_request(request.url,request.method,binding)


def matches_renderer_request(url, method, binding):
    try:
        if not isinstance(binding,dict) or binding.get("bindingHash") != digest({key:value for key,value in binding.items() if key != "bindingHash"}): return False
        if method != "GET" or not isinstance(url,str) or len(url) > 24000 or re.search(r"[\x00-\x20\x7f\\]",url): return False
        target, expected = urlsplit(url), urlsplit(binding["rendererURL"])
        if target.scheme != "https" or target.netloc != "lennox.nexvia.com.au" or target.fragment \
                or target.path != expected.path or target.path != RENDERER_PREFIX+str(binding["nativeFileId"]): return False
        if re.search(r"%(?![a-fA-F0-9]{2})",target.query): return False
        pairs = parse_qsl(target.query,keep_blank_values=True,strict_parsing=True,max_num_fields=5,errors="strict")
        expected_pairs = _renderer_suffix("?"+expected.query)
        values, wanted = dict(pairs), dict(expected_pairs)
        if len(values) != len(pairs): return False
        wanted.pop("_",None)
        return {key:value for key,value in values.items() if key != "_"} == wanted \
            and ("_" not in values or re.fullmatch(r"[0-9]{1,20}",values["_"]) is not None)
    except (ValueError,TypeError,KeyError,UnicodeError): return False


def public_binding(binding):
    return {"nativeFileId":binding["nativeFileId"],"locationHash":digest(binding["exactLocation"]),
            "objectKeyHash":digest(binding["signedKey"]),"signedFieldsDigest":binding["signedFieldsDigest"],
            "contractHash":binding["contractHash"],"bindingHash":binding["bindingHash"],
            "rendererURLHash":digest(binding["rendererURL"]),
            "doneSourceSha256":binding["doneSourceSha256"],"doneProfileSha256":binding["doneProfileSha256"],
            "sendSourceSha256":binding["sendSourceSha256"]}
