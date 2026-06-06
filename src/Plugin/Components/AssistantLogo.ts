export default function assistantLogo(): SVGElement {
    const uniqueId = `paint0_linear_${Math.random().toString(36).substring(2, 9)}`; // Generate a unique ID
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");

    const circle = activeDocument.createElementNS(svgNamespace, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "12");
    circle.setAttribute("fill", `url(#${uniqueId})`); // Reference the unique ID here
    svg.appendChild(circle);

    const defs = activeDocument.createElementNS(svgNamespace, "defs");
    const linearGradient = activeDocument.createElementNS(svgNamespace, "linearGradient");
    linearGradient.setAttribute("id", uniqueId); // Use the unique ID
    linearGradient.setAttribute("x1", "12");
    linearGradient.setAttribute("y1", "-0.000414185");
    linearGradient.setAttribute("x2", "12");
    linearGradient.setAttribute("y2", "24");
    linearGradient.setAttribute("gradientUnits", "userSpaceOnUse");

    const stop1 = activeDocument.createElementNS(svgNamespace, "stop");
    stop1.setAttribute("stop-color", "var(--color-accent)");
    linearGradient.appendChild(stop1);

    const stop2 = activeDocument.createElementNS(svgNamespace, "stop");
    stop2.setAttribute("offset", "1");
    stop2.setAttribute("stop-color", "var(--color-accent)");
    stop2.setAttribute("stop-opacity", "0.1");
    linearGradient.appendChild(stop2);

    defs.appendChild(linearGradient);
    svg.appendChild(defs);

    return svg;
}
