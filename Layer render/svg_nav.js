
class SvgNavigator {
    constructor(svg, viewport) {
        this.svg = svg;
        this.viewport = viewport;
        this.tx = 0; this.ty = 0; this.scale = 1; this.rotation = 0;
        this._initEvents();
        this._apply();
    }

    _apply() {
        this.viewport.setAttribute(
            "transform",
            `translate(${this.tx},${this.ty}) scale(${this.scale}) rotate(${this.rotation})`
        );
    }

    pan(dx, dy) {
        this.tx += dx;
        this.ty += dy;
        this._apply();
    }

    zoom(factor, cx, cy) {
        if (cx === undefined || cy === undefined) {
            cx = this.svg.clientWidth / 2;
            cy = this.svg.clientHeight / 2;
        }
        const pt = this.svg.createSVGPoint();
        pt.x = cx; pt.y = cy;
        const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());

        this.tx -= (svgP.x - this.tx) * (factor - 1);
        this.ty -= (svgP.y - this.ty) * (factor - 1);

        this.scale *= factor;
        this._apply();
    }

    rotate(d) { this.rotation += d; this._apply(); }
    reset() { this.tx = 0; this.ty = 0; this.scale = 1; this.rotation = 0; this._apply(); }

    _initEvents() {
        // wheel zoom around cursor
        this.svg.addEventListener("wheel", e => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.2 : 0.8;
            this.zoom(factor, e.clientX, e.clientY);
        });

        // mouse drag pan (scaled)
        let dragging = false, lastX = 0, lastY = 0;
        this.svg.addEventListener("pointerdown", e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
        this.svg.addEventListener("pointerup", () => dragging = false);
        this.svg.addEventListener("pointerleave", () => dragging = false);
        this.svg.addEventListener("pointermove", e => {
            if (!dragging) return;
            const dx = (e.clientX - lastX);
            const dy = (e.clientY - lastY);
            this.pan(dx, dy);
            lastX = e.clientX; lastY = e.clientY;
        });

        // keyboard
        document.addEventListener("keydown", e => {
            switch (e.key) {
                case "ArrowUp": case "w": this.pan(0, 100); break;
                case "ArrowDown": case "s": this.pan(0, -100); break;
                case "ArrowLeft": case "a": this.pan(100, 0); break;
                case "ArrowRight": case "d": this.pan(-100, 0); break;
                case "q": this.rotate(-90); break;
                case "e": this.rotate(90); break;
                case "r": this.reset(); break;
            }
        });


        // touch: one finger pan, two fingers pinch+rotate
        let startDist = 0, startAngle = 0, startScale = 1, startRot = 0;
        let startTx = 0, startTy = 0;
        let startMid = null;
        let lastTouchX = 0, lastTouchY = 0;

        this.svg.addEventListener("touchstart", e => {
            if (e.touches.length === 1) {
                lastTouchX = e.touches[0].clientX;
                lastTouchY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                startDist = Math.hypot(dx, dy);
                startAngle = Math.atan2(dy, dx);
                startScale = this.scale;
                startRot = this.rotation;
                startTx = this.tx;
                startTy = this.ty;
                startMid = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            }
        }, { passive: false });

        this.svg.addEventListener("touchmove", e => {
            if (e.touches.length === 1) {
                e.preventDefault();
                // NOTE: don't divide by scale here -> keeps touch drag consistent
                const dx = (e.touches[0].clientX - lastTouchX);
                const dy = (e.touches[0].clientY - lastTouchY);
                this.pan(dx, dy);
                lastTouchX = e.touches[0].clientX;
                lastTouchY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dist = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);

                const scaleFactor = dist / startDist;
                this.scale = startScale * scaleFactor;
                this.rotation = startRot + (angle - startAngle) * 180 / Math.PI;

                // compute new midpoint in screen space
                const mid = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };

                // map both midpoints to SVG space
                const pt1 = this.svg.createSVGPoint(); pt1.x = startMid.x; pt1.y = startMid.y;
                const svgP1 = pt1.matrixTransform(this.svg.getScreenCTM().inverse());

                const pt2 = this.svg.createSVGPoint(); pt2.x = mid.x; pt2.y = mid.y;
                const svgP2 = pt2.matrixTransform(this.svg.getScreenCTM().inverse());

                // adjust tx/ty so the midpoint stays under the fingers
                this.tx = startTx + (svgP2.x - svgP1.x);
                this.ty = startTy + (svgP2.y - svgP1.y);

                this._apply();
            }
        }, { passive: false });
    }
}


// ====================== Controls UI ======================

function addControls(svg, nav) {
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.setAttribute("id", "wrap");
    g.setAttribute("transform", "translate(50,50)");

    function button(x, y, label, cb, className) {
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", x); rect.setAttribute("y", y);
        rect.setAttribute("width", 40); rect.setAttribute("height", 40);
        rect.setAttribute("rx", 6);
        rect.setAttribute("fill", "#fff"); rect.setAttribute("stroke", "#333");
        rect.style.cursor = "pointer";
        if (className != "") {
            rect.setAttribute("class", className);
        }
        rect.addEventListener("click", cb);

        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", x + 20); text.setAttribute("y", y + 25);
        text.setAttribute("font-size", "16");
        text.setAttribute("text-anchor", "middle");
        text.textContent = label;
        text.style.pointerEvents = "none";

        g.appendChild(rect); g.appendChild(text);
    }

    button(40, 0, "↑", () => nav.pan(0, 100), "");
    button(40, 80, "↓", () => nav.pan(0, -100), "");
    button(0, 40, "←", () => nav.pan(100, 0), "");
    button(80, 40, "→", () => nav.pan(-100, 0), "");
    button(130, 20, "+", () => nav.zoom(1.2, window.width / 2, window.height / 2), "");
    button(130, 60, "-", () => nav.zoom(0.8, window.width / 2, window.height / 2), "");
    button(-40, -40, "⟲", () => nav.rotate(-90), "");
    button(120, -40, "⟳", () => nav.rotate(90), "");
    button(-50, 80, "⌂", () => nav.reset(), "resetView");

    svg.appendChild(g);
}