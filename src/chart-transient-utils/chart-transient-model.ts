import { formatFilterName } from "../chart-transient";
import { filterWavelength } from "../chart-cluster-utils/chart-cluster-util";
import { calculateLambda } from "../chart-cluster-utils/chart-cluster-util";
import { baseUrl } from "../chart-cluster-utils/chart-cluster-util";

const DEBUG = false;

export class Model {
    private _temporalIndex: number;
    private _spectralIndex: number;
    private _referenceTime: number;
    private _referenceMagn: number;
    private _atmExtinction: number;
    private _referenceFltr: string;

    constructor(form: VariableLightCurveForm) {
        this.temporalIndex = parseFloat(form["a_num"].value);
        this.spectralIndex = parseFloat(form["b_num"].value);
        this.referenceTime = parseFloat(form["t_num"].value);
        this.referenceMagn = parseFloat(form["mag_num"].value);
        this.atmExtinction = parseFloat(form["ebv_num"].value);
        this.referenceFltr = form["filter"].value;
    }

    /* METHODS */
    calculate(filter: string, currentTime: number): number {
        const wavelength = filterWavelength;
        const eventTime = 0;//parseFloat(this.form["time"].value);
        const f  = wavelength[filter];
        const f0 = wavelength[this.referenceFltr];
        const Rv = 3.1;

        const FZP0 = ZERO_POINT_VALUES[this.referenceFltr];
        const FZP = ZERO_POINT_VALUES[filter];
        const td = currentTime - eventTime;
        const Anu = calculateLambda(this.atmExtinction*Rv, wavelength[this.referenceFltr]);

        const eq1 = Math.log10(FZP0 / FZP);
        const eq2 = this.temporalIndex * Math.log10(td / this.referenceTime);
        const eq3 = this.spectralIndex * Math.log10(f / f0);
        const eq4 = Anu / 2.5;

        if (DEBUG) {
            console.log('Flux term: ', eq1);
            console.log('Time term: ', eq2);
            console.log('Frequency term: ', eq3);
            console.log('Extinction term: ', eq4);
            console.log('Combined: ', this.referenceMagn - 2.5 * (eq1 + eq2 + eq3 - eq4));
            console.log('-');
        }
        return this.referenceMagn - (2.5 * (eq1 + eq2 + eq3 - eq4));
    }

    /* GETTERS */
    get temporalIndex(): number {
        return this._temporalIndex;
    }

    get spectralIndex(): number {
        return this._spectralIndex;
    }

    get referenceTime(): number {
        return this._referenceTime;
    }

    get referenceMagn(): number {
        return this._referenceMagn;
    }

    get atmExtinction(): number {
        return this._atmExtinction;
    }

    get referenceFltr(): string {
        return this._referenceFltr;
    }

    /* SETTERS */
    set temporalIndex(i: number) {
        if (isNaN(i)) {
            this._temporalIndex = -0.65;
            console.log('temporal index set to -0.65');
        } else {
            this._temporalIndex = i;
        }
    }

    set spectralIndex(i: number) {
        if (isNaN(i)) {
            this._spectralIndex = -0.5;
            console.log('spectral index set to -0.5');
        } else {
            this._spectralIndex = i;
        }
    }

    set referenceTime(t: number) {
        if (isNaN(t)) {
            this._referenceTime = 8.0;
            console.log('reference time set to 8');
        } else {
            this._referenceTime = t;
        }
    }

    set referenceMagn(m: number) {
        if (isNaN(m)) {
            this._referenceMagn = 10.0;
            console.log('reference magnitude set to 10');
        } else {
            this._referenceMagn = m;
        }
    }

    set atmExtinction(ae: number) {
        if (isNaN(ae)) {
            this._atmExtinction = 0.0;
            console.log('Atmospheric Extinction set to 8.0');
        } else {
            this._atmExtinction = ae;
        }
    }

    set referenceFltr(f: string) {
        if (f === null) {
            this._referenceFltr = 'U';
            console.log('reference filter set to \'U\'');
        } else {
            this._referenceFltr = f;
        }
    }

}


// algorithmic model
export class NonLinearRegression extends Model {
    xdata: Array<number> = [];
    ydata: Array<number> = [];
    filters: {[x: number]: string} = {};

    constructor(form: VariableLightCurveForm, data: any[], eventTime: number, range?: Array<number>) {
        super(form);

        if (!range) {
            range = [Number.NEGATIVE_INFINITY , Number.POSITIVE_INFINITY]
        }

        for (let i = 0; i < data.length; i++) {
            // move this to main driver file. no need to do here.
            if (data[i][0] > range[0] && data[i][0] < range[1]) {
                this.xdata.push(data[i][0] - eventTime);
                this.ydata.push(data[i][1]);
                this.filters[(data[i][0] - eventTime)] = formatFilterName(data[i][2]);
            }
        }
    }

    /* METHODS */
    private parameters() {
        if (!this.xdata || !this.ydata) {
            console.log('Missing data');
            return {};
        }
        if (!this.filters) {
            console.log('Missing filters');
            return {};
        }
        if (!this.referenceFltr ||
            isNaN(this.referenceMagn) || 
            isNaN(this.referenceTime) ||
            isNaN(this.temporalIndex) ||
            isNaN(this.spectralIndex)) {
                console.log('Missing form parameter(s)');
                return {};
        }
        return {
            'xdata': this.xdata,
            'ydata': this.ydata,
            'filters': this.filters, 
            'params': {
               'm': this.referenceMagn,
               'a': this.temporalIndex,
               'b': this.spectralIndex,
               't': this.referenceTime,
               'filter': this.referenceFltr,
            }
        };
    }

    private LMSFormUpdate(response: any) {
        const form = document
            .getElementById('transient-form') as VariableLightCurveForm;
        // text entries
        form['mag_num'].value = parseFloat(response['popt'][0]);
        form['a_num'].value = parseFloat(response['popt'][1]);
        form['b_num'].value = parseFloat(response['popt'][2]);
        // sliders
        form['mag'].value = parseFloat(response['popt'][0]);
        form['a'].value = parseFloat(response['popt'][1]);
        form['b'].value = parseFloat(response['popt'][2]);
    }

    private LSMServerRequest() {
        return new Promise(resolve => {
            let xmlhttp = new XMLHttpRequest;
            let url = baseUrl + "/transient";
            let updateForm = this.LMSFormUpdate;

            xmlhttp.onload = function() {
                if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
                    let response = JSON.parse(xmlhttp.responseText);
                    updateForm(response);
                    resolve('success');
                } else {
                    resolve('failure');
                }
            }
            xmlhttp.open("POST", url, true);
            xmlhttp.setRequestHeader("Content-Type", "application/json");
            xmlhttp.send(JSON.stringify(this.parameters()));
        });
    }

    async leastSquaresMethod() {
        return await this.LSMServerRequest();    
    }
}


/* UTILS */
// move this to a transient-util file
const ZERO_POINT_VALUES: { [key: string]: number } = {
    'U' : 1.790,
    'B' : 4.063,
    'V' : 3.636,
    'R' : 3.064,
    'I' : 2.416,
    'J' : 1.589,
    'H' : 1.021,
    'K' : 0.640,
    "u\'": 3.680,
    "g\'": 3.643,
    "r\'": 3.648,
    "i\'": 3.644,
    "z\'": 3.631,
}