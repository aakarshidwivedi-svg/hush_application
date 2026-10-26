/** Consistent success envelope: `{ data }` or `{ data, page }`. */
export function ok(res, data, status = 200) {
    res.status(status).json({ data });
}
export function okPage(res, data, page) {
    res.status(200).json({ data, page });
}
