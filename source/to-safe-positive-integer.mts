// https://www.rfc-editor.org/rfc/rfc9111.html#name-delta-seconds
export const toSafePositiveInteger = (x: string | null | undefined): number | undefined => {
    if (x === null || x === undefined) {
        return;
    }

    for (const letter of x) {
        if (   letter !== '0'
            && letter !== '1'
            && letter !== '2'
            && letter !== '3'
            && letter !== '4'
            && letter !== '5'
            && letter !== '6'
            && letter !== '7'
            && letter !== '8'
            && letter !== '9'
        ) {
            return;
        }
    }

    const parsed = Number.parseInt(x, 10);

    if (Number.isSafeInteger(parsed)) {
        return parsed;
    }

    return;
};
