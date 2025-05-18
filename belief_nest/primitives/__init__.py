import pkg_resources
import os
import belief_nest.utils as U


def load_primitives(primitive_names=None):
    package_path = pkg_resources.resource_filename("belief_nest", "")
    if primitive_names is None:
        suffix = ".js"
        primitive_names = [
            primitives[:-len(suffix)]
            for primitives in os.listdir(f"{package_path}/primitives")
            if primitives.endswith(suffix)
        ]
    primitives = [
        U.load_text(f"{package_path}/primitives/{primitive_name}.js")
        for primitive_name in primitive_names
    ]
    return primitives
