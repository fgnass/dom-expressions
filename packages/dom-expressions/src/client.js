import {
  Properties,
  ChildProperties,
  Aliases,
  PropAliases,
  SVGNamespace,
  DelegatedEvents
} from "./constants";
import { root, effect, memo, getOwner, createComponent, sharedConfig } from "rxcore";
import reconcileArrays from "./reconcile";
export {
  Properties,
  ChildProperties,
  PropAliases,
  Aliases,
  DOMElements,
  SVGElements,
  SVGNamespace,
  DelegatedEvents
} from "./constants";

const $$EVENTS = "_$DX_DELEGATE";

export { effect, memo, getOwner, createComponent, Assets as HydrationScript };

export function render(code, element, init) {
  let disposer;
  root(dispose => {
    disposer = dispose;
    element === document
      ? code()
      : insert(element, code(), element.firstChild ? null : undefined, init);
  });
  return () => {
    disposer();
    element.textContent = "";
  };
}

export function template(html, check, isSVG) {
  const t = document.createElement("template");
  t.innerHTML = html;
  if ("_DX_DEV_" && check && t.innerHTML.split("<").length - 1 !== check)
    throw `The browser resolved template HTML does not match JSX input:\n${t.innerHTML}\n\n${html}. Is your HTML properly formed?`;
  let node = t.content.firstChild;
  if (isSVG) node = node.firstChild;
  return node;
}

export function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}

export function clearDelegatedEvents(document = window.document) {
  if (document[$$EVENTS]) {
    for (let name of document[$$EVENTS].keys()) document.removeEventListener(name, eventHandler);
    delete document[$$EVENTS];
  }
}

export function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

export function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name);
  else node.setAttributeNS(namespace, name, value);
}

export function className(node, value) {
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}

export function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)));
  } else node.addEventListener(name, handler);
}

export function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value || {}),
    prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}

export function style(node, value, prev = {}) {
  const nodeStyle = node.style;
  const prevString = typeof prev === "string";
  if ((value == null && prevString) || typeof value === "string")
    return (nodeStyle.cssText = value);
  prevString && ((nodeStyle.cssText = undefined), (prev = {}));
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}

export function spread(node, accessor, isSVG, skipChildren) {
  if (typeof accessor === "function") {
    effect(current => spreadExpression(node, accessor(), current, isSVG, skipChildren));
  } else spreadExpression(node, accessor, undefined, isSVG, skipChildren);
}

export function mergeProps(...sources) {
  const target = {};
  for (let i = 0; i < sources.length; i++) {
    let source = sources[i];
    if (typeof source === "function") source = source();
    if (source) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
  }
  return target;
}

export function dynamicProperty(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
  return props;
}

export function innerHTML(parent, content) {
  !sharedConfig.context && (parent.innerHTML = content);
}

export function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  effect(current => insertExpression(parent, accessor(), current, marker), initial);
}

export function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      assignProp(node, prop, null, prevProps[prop], isSVG, skipRef);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, props.children);
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef);
  }
}

// Hydrate
export function hydrate(code, element, options = {}) {
  sharedConfig.completed = globalThis._$HY.completed;
  sharedConfig.events = globalThis._$HY.events;
  sharedConfig.load = globalThis._$HY.load;
  sharedConfig.gather = root => gatherHydratable(element, root);
  sharedConfig.registry = new Map();
  sharedConfig.context = {
    id: options.renderId || "",
    count: 0
  };
  gatherHydratable(element, options.renderId);
  const dispose = render(code, element, [...element.childNodes]);
  sharedConfig.context = null;
  return dispose;
}

export function getNextElement(template) {
  let node, key;
  if (!sharedConfig.context || !(node = sharedConfig.registry.get((key = getHydrationKey())))) {
    return template.cloneNode(true);
  }
  if (sharedConfig.completed) sharedConfig.completed.add(node);
  sharedConfig.registry.delete(key);
  return node;
}

export function getNextMatch(el, nodeName) {
  while (el && el.localName !== nodeName) el = el.nextSibling;
  return el;
}

export function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  if (sharedConfig.context) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        if (v === "#") count++;
        else if (v === "/") {
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}

export function runHydrationEvents() {
  if (sharedConfig.events && !sharedConfig.events.queued) {
    queueMicrotask(() => {
      const { completed, events } = sharedConfig;
      events.queued = false;
      while (events.length) {
        const [el, e] = events[0];
        if (!completed.has(el)) return;
        eventHandler(e);
        events.shift();
      }
    });
    sharedConfig.events.queued = true;
  }
}

// Internal Functions
function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}

function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++)
    node.classList.toggle(classNames[i], value);
}

function assignProp(node, prop, value, prev, isSVG, skipRef) {
  let isCE, isProp, isChildProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) {
      value(node);
    }
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev);
    value && node.addEventListener(e, value);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value && node.addEventListener(e, value, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (
    (isChildProp = ChildProperties.has(prop)) ||
    (!isSVG && (PropAliases[prop] || (isProp = Properties.has(prop)))) ||
    (isCE = node.nodeName.includes("-"))
  ) {
    if (prop === "class" || prop === "className") className(node, value);
    else if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;
    else node[PropAliases[prop] || prop] = value;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}

function eventHandler(e) {
  const key = `$$${e.type}`;
  let node = (e.composedPath && e.composedPath()[0]) || e.target;
  // reverse Shadow DOM retargetting
  if (e.target !== node) {
    Object.defineProperty(e, "target", {
      configurable: true,
      value: node
    });
  }

  // simulate currentTarget
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });

  // cancel html streaming
  if (sharedConfig.registry && !sharedConfig.done) {
    sharedConfig.done = true;
    document.querySelectorAll("[id^=pl-]").forEach(elem => elem.remove());
  }

  while (node !== null) {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node =
      node.host && node.host !== node && node.host instanceof Node ? node.host : node.parentNode;
  }
}

function spreadExpression(node, props, prevProps = {}, isSVG, skipChildren) {
  props || (props = {});
  if (!skipChildren && "children" in props) {
    effect(() => (prevProps.children = insertExpression(node, props.children, prevProps.children)));
  }
  props.ref && props.ref(node);
  effect(() => assign(node, props, isSVG, true, prevProps, true));
  return prevProps;
}

function insertExpression(parent, value, current, marker, unwrapArray) {
  if (sharedConfig.context && !current) current = [...parent.childNodes];
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = (multi && current[0] && current[0].parentNode) || parent;

  if (t === "string" || t === "number") {
    if (sharedConfig.context) return current;
    if (t === "number") value = value.toString();
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data = value;
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    if (sharedConfig.context) return current;
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    effect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    if (normalizeIncomingArray(array, value, unwrapArray)) {
      effect(() => (current = insertExpression(parent, array, current, marker, true)));
      return () => current;
    }
    if (sharedConfig.context) {
      for (let i = 0; i < array.length; i++) {
        if (array[i].parentNode) return (current = array);
      }
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (Array.isArray(current)) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value instanceof Node) {
    if (sharedConfig.context && value.parentNode) return (current = multi ? [value] : value);
    if (Array.isArray(current)) {
      if (multi) return (current = cleanChildren(parent, current, marker, value));
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else if ("_DX_DEV_") console.warn(`Unrecognized value. Skipped inserting`, value);

  return current;
}

function normalizeIncomingArray(normalized, array, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      t;
    if (item instanceof Node) {
      normalized.push(item);
    } else if (item == null || item === true || item === false) {
      // matches null, undefined, true or false
      // skip
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item) || dynamic;
    } else if ((t = typeof item) === "string") {
      normalized.push(document.createTextNode(item));
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic =
          normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else normalized.push(document.createTextNode(item.toString()));
  }
  return dynamic;
}

function appendNodes(parent, array, marker) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return (parent.textContent = "");
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i)
          isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}

function gatherHydratable(element, root) {
  const templates = element.querySelectorAll(`*[data-hk]`);
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    const key = node.getAttribute("data-hk");
    if ((!root || key.startsWith(root)) && !sharedConfig.registry.has(key))
      sharedConfig.registry.set(key, node);
  }
}

export function getHydrationKey() {
  const hydrate = sharedConfig.context;
  return `${hydrate.id}${hydrate.count++}`;
}

// Components
export function Assets() {
  return;
}

export function NoHydration(props) {
  return sharedConfig.context ? undefined : props.children;
}
