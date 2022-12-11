const New = (() => {
    const version = "0.0.1";

    let dependent;

    const scope = (statement, closure) => {
        if (typeof closure !== "object") return new Function("return " + statement);
        const declaration = Object
            .getOwnPropertyNames(closure)
            .map(property => (`let ${property}=this["${property}"]`))
            .join(";")
            .concat("; return ");
        return (new Function(declaration + statement)).bind(closure);
    };

    const reactiveForArray = (array, dependents) => {
        if (!Array.isArray(array)) return;
        array.fill = function () {
            Array.prototype.fill.apply(array, arguments);
        };
        array.reverse = function () {
            Array.prototype.reverse.apply(array, arguments);
        };
        array.sort = function () {
            Array.prototype.sort.apply(array, arguments);
        };
        ["pop", "push", "shift", "splice", "unshift"].forEach((method) => {
            Object.defineProperty(array, method, {
                configurable: false, value: function () {
                    const _return = Array.prototype[method].apply(array, arguments);
                    reactive(array);
                    dependents.forEach(d => d());
                    return _return;
                }
            });
        });
    };

    const reactive = (object) => {
        if (typeof object !== "object" && object !== null) return;

        Object.getOwnPropertyNames(object).forEach((prop) => {
            reactive(object[prop]);
            if (!Object.getOwnPropertyDescriptor(object, prop).configurable) return;
            let data = object[prop];
            const dependents = [];

            if (Array.isArray(data)) {
                reactiveForArray(data, dependents);
            }

            Object.defineProperty(object, prop, {
                get: () => {
                    if (dependent) dependents.push(dependent);
                    return data;
                }, set: (value) => {
                    if (Array.isArray(data) && Array.isArray(value)) {
                        if (value.length === 0) {
                            data.splice(0, data.length);
                        } else if (data.length > value.length) {
                            value.forEach((v, i) => data[i] = v);
                            data.splice(value.length, data.length - value.length);
                        } else if (data.length < value.length) {
                            value.forEach((v, i) => {
                                if (i <= data.length - 1) {
                                    data[i] = v;
                                } else {
                                    data.push(v);
                                }
                            });
                        } else {
                            value.forEach((v, i) => data[i] = v);
                        }
                        return;
                    }

                    if (typeof value === "object" && typeof data === "object") {
                        Object.getOwnPropertyNames(data).forEach(p => {
                            if (!value.hasOwnProperty(p)) return;
                            data[p] = value[p];
                        });
                        return;
                    }
                    data = value;
                    dependents.forEach(d => d());
                }
            });
        });
    };

    const condition = (node, closure) => {
        if (node.getAttribute("@if") === null) return true;
        const expression = node.getAttribute("@if");
        const parent = node.parentElement;
        const prev = node.previousSibling;
        node.removeAttribute("@if");
        let r = undefined;
        dependent = () => {
            const result = scope(expression, closure)();
            if (r === result) return r;
            if (node.parentElement && !result) {
                node.parentElement.removeChild(node);
            } else if (!node.parentElement && result) {
                for (let child of node.childNodes) engine(child, closure);
                if (prev) prev.after(node); else parent.insertBefore(node, parent.firstChild);
            }
            r = result;
            return !!result;
        };
        const result = dependent();
        dependent = undefined;
        return result;
    };

    const loop = (node, closure) => {
        if (node.getAttribute("@for") === null) return false;
        const expression = node.getAttribute("@for");
        node.removeAttribute("@for");
        const part = expression.split(":").map(p => p.trim());
        if (part.length !== 2) return false;
        const template = node.cloneNode(true);
        const previous = node.previousSibling;
        const parent = node.parentElement;
        node.remove();
        const nodes = [];
        dependent = () => {
            nodes.forEach(n => n.remove());
            nodes.length = 0;
            const array = scope(part[1], closure)();
            dependent = undefined;
            if (!Array.isArray(array)) return true;
            array.forEach((item, i) => {
                const element = template.cloneNode(true);
                nodes.push(parent.insertBefore(element, previous));
                const c = {};
                if (typeof closure === "object") {
                    Object.getOwnPropertyNames(closure).forEach(prop => {
                        Object.defineProperty(c, prop, Object.getOwnPropertyDescriptor(closure, prop))
                    });
                }
                Object.defineProperty(c, part[0], Object.getOwnPropertyDescriptor(array, i));
                engine(element, c);
            });
        }
        dependent();
        return true;
    };

    const attr = (node, closure) => {
        if (!(node instanceof Element)) return;
        const regex = new RegExp("{{([^}]*)}}", "g");
        for (let i = 0; i < node.attributes.length; ++i) {
            if (!regex.test(node.attributes[i].textContent)) continue;
            const value = node.attributes[i].textContent;
            const name = node.attributes[i].name;
            let rendered = undefined;
            dependent = () => {
                const r = value.replaceAll(regex, (_, e) => scope(e, closure)());
                if (r === rendered) return;
                node.setAttribute(name, r)
                rendered = r;
            };
            dependent();
            dependent = undefined;
        }
    };

    const key = (node, closure) => {
        if (!(node instanceof Element)) return;
        [...node.attributes]
            .filter(attr => attr.name.indexOf("?") === 0)
            .map(attr => ({
                name: attr.name.slice(1), val: attr.textContent
            }))
            .forEach(attr => {
                node.removeAttribute("?" + attr.name);
                let result = undefined;
                dependent = () => {
                    const r = scope(attr.val, closure)();
                    if (r === result) return;
                    if (r) {
                        node.setAttribute(attr.name, "");
                    } else {
                        node.removeAttribute(attr.name);
                    }
                    result = r;
                };
                dependent();
                dependent = undefined;
            });
    };

    const event = (node, closure) => {
        if (!(node instanceof Element)) return;
        [...node.attributes]
            .filter(attr => attr.name.indexOf("#") === 0)
            .map(attr => ({
                name: attr.name.slice(1), val: attr.textContent
            }))
            .forEach(attr => {
                node.removeAttribute("#" + attr.name);
                let handler;
                dependent = () => {
                    handler = (e) => {
                        const c = {};
                        if (typeof closure === "object") {
                            Object.getOwnPropertyNames(closure).forEach(prop => {
                                Object.defineProperty(c, prop, Object.getOwnPropertyDescriptor(closure, prop))
                            });
                        }
                        Object.defineProperty(c, "$event", {
                            value: e
                        });
                        scope(attr.val, c)();
                    }
                }
                dependent();
                dependent = undefined;
                node.addEventListener(attr.name, (e) => handler(e));
            });
    };

    const engine = (node, closure) => {
        if (node instanceof Text) {
            const regex = new RegExp("{{([^}]*)}}", "g");
            if (!regex.test(node.textContent)) return;
            const content = node.textContent;
            let result = undefined;
            dependent = () => {
                const r = content.replaceAll(regex, (_, e) => scope(e, closure)());
                if (r === result) return;
                node.textContent = r;
                result = r;
            }
            dependent();
            dependent = undefined;
        } else if (!(node instanceof HTMLScriptElement) && !(node instanceof HTMLStyleElement) && !(node instanceof HTMLIFrameElement)) {
            if (loop(node, closure)) {
            } else if (condition(node, closure)) {
                key(node, closure);
                attr(node, closure);
                event(node, closure);
                [...node.childNodes]
                    .forEach((n) => engine(n, closure));
            }

        }
    };

    const init = (el) => {
        [...el.childNodes].forEach((node) => engine(node));
    };

    return function (state, selector) {
        if (typeof state !== "object") {
            console.warn("State accepted if and only if it is object.");
            return;
        }
        if (!document.querySelector(selector)) {
            console.warn("Selector doesn't describe a proper HTMLElement.");
            return;
        }
        reactive(state);

        this.version = version;
        this.element = document.querySelector(selector);
        this.state = state;

        if (document.readyState === "complete") {
            init(this.element);
        } else {
            document.addEventListener("DOMContentLoaded", () => {
                init(this.element);
            });
        }
    };
})();