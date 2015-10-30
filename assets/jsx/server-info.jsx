var React = require('react/addons');

class ServerInfo extends React.Component {
    constructor(props) {
        super(props);
    }

    handleChange(event) {
        this.props.updateServerInfo(event.target.id, event.target.value);
    }

    render() {
        var ConfigurationStatus = 'FIXME: implement S3 access check!';

        return (
            <div className="server-info well well-sm clearfix">
                <h3>S3 Configuration <a target="help" href="help.html#s3-cors"><i className="glyphicon glyphicon-question-sign"></i></a></h3>

                <form className="form-horizontal">
                    <div className="form-group">
                        <label className="col-sm-2 control-label" htmlFor="accessKeyId">Access Key</label>
                        <div className="col-sm-10">
                            <input type="text" className="form-control" id="accessKeyId" value={this.props.accessKeyId} onChange={this.handleChange.bind(this)} />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="col-sm-2 control-label" htmlFor="secretAccessKey">Secret Key</label>
                        <div className="col-sm-10">
                            <input type="password" className="form-control" id="secretAccessKey" value={this.props.secretAccessKey} onChange={this.handleChange.bind(this)} />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="col-sm-2 control-label" htmlFor="region">Region</label>
                        <div className="col-sm-10">
                            <input type="text" className="form-control" id="region" value={this.props.region} onChange={this.handleChange.bind(this)} />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="col-sm-2 control-label" htmlFor="bucket">Bucket <b className="text-danger">FIXME: retrieve list after keys are set</b></label>
                        <div className="col-sm-10">
                            <input type="text" className="form-control" id="bucket" value={this.props.bucket} onChange={this.handleChange.bind(this)} />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-default">Test Configuration</button>

                    <p className="text-warning">{ConfigurationStatus}</p>
                </form>
            </div>
        );
    }
}

export { ServerInfo };
